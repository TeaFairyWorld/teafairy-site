-- Ready for a human to apply on project tkxepmevhhzfmorbhriz only.
-- Not applied by this repository. Does not seed vouchers, codes, peppers, or addresses.
--
-- Anonymous visitors use the edge function gift-submit, which calls public.gift_redeem
-- with the service role. public.gift_redeem is not granted to anon: a public execute
-- grant is not required, and would skip the function's arming switch.
-- Management functions stay in gift_private and are not granted to anon or service_role.
-- Do not add gift_private to the exposed API schemas, and do not run a "grant all to
-- anon" snippet for this schema.

create schema if not exists gift_private;
revoke all on schema gift_private from public;

comment on schema gift_private is
  'Gift redemption. Not an API schema. Anon cannot read or write these tables.';

create schema if not exists extensions;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pgcrypto') then
    create extension pgcrypto with schema extensions;
  end if;
end $$;

create table gift_private.vouchers (
  id text primary key,
  batch text not null,
  tier text not null,
  code_hash bytea not null unique,
  status text not null default 'active',
  consumed_at timestamptz,
  constraint vouchers_batch check (batch in ('production', 'test')),
  constraint vouchers_status check (status in ('active', 'consumed')),
  constraint vouchers_hash_len check (octet_length(code_hash) = 32),
  constraint vouchers_consumed_pair check (
    (status = 'active' and consumed_at is null)
    or (status = 'consumed' and consumed_at is not null)
  ),
  constraint vouchers_id_tier_batch check (
    (
      batch = 'production'
      and (
        (id ~ '^G(0[1-9]|1[0-9]|20)$' and tier = 'standard')
        or (id = 'GP01' and tier = 'grand')
      )
    )
    or (
      batch = 'test'
      and (
        (id ~ '^T0[1-5]$' and tier = 'standard')
        or (id = 'TP01' and tier = 'grand')
      )
    )
  )
);

comment on table gift_private.vouchers is
  'Internal ids only. G01-G20 and GP01 are production. T01-T05 and TP01 are a TEST-ONLY batch. code_hash is HMAC-SHA256 of the canonical code. The code is not stored here. GP01 and TP01 are the grand prize only and do not include a standard gift.';

create table gift_private.addresses (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  voucher_id text not null unique references gift_private.vouchers (id),
  recipient_name text not null,
  phone text not null,
  email text,
  address1 text not null,
  address2 text,
  city text not null,
  postcode text not null,
  country text not null,
  consented_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint addresses_country check (country in ('GB', 'CN', 'HK', 'MO', 'IE')),
  constraint addresses_fields check (
    char_length(recipient_name) between 1 and 100
    and char_length(phone) between 7 and 24
    and (email is null or char_length(email) between 3 and 254)
    and char_length(address1) between 1 and 120
    and (address2 is null or char_length(address2) between 1 and 120)
    and char_length(city) between 1 and 80
    and char_length(postcode) between 1 and 16
  )
);

comment on table gift_private.addresses is
  'Delivery details only. No gift code and no code hash. Inserted by gift_private.redeem. Not readable by anon.';

create table gift_private.distribution (
  voucher_id text primary key references gift_private.vouchers (id),
  plaintext_code text not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint distribution_code check (plaintext_code ~ '^[0-9A-HJKMNP-TV-Z]{26}$')
);

comment on table gift_private.distribution is
  'Owner-only plaintext list waiting to be copied privately and then cleared. Not an API table. Do not copy it into git or chat.';

alter table gift_private.vouchers enable row level security;
alter table gift_private.vouchers force row level security;
alter table gift_private.addresses enable row level security;
alter table gift_private.addresses force row level security;
alter table gift_private.distribution enable row level security;
alter table gift_private.distribution force row level security;

revoke all on gift_private.vouchers from public;
revoke all on gift_private.addresses from public;
revoke all on gift_private.distribution from public;

-- 16 bytes become 26 Crockford characters. 128 bits plus 2 zero padding bits.
-- Same padding as a 5-bit encoder that emits a final partial symbol with low bits zero.
create function gift_private.encode_crockford(p bytea)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  bits bit varying := ''::bit varying;
  alph text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  out text := '';
  i integer;
  n integer;
begin
  if octet_length(p) is distinct from 16 then
    raise exception 'code entropy';
  end if;
  for i in 0..15 loop
    bits := bits || get_byte(p, i)::bit(8);
  end loop;
  bits := bits || b'00';
  if bit_length(bits) is distinct from 130 then
    raise exception 'code entropy';
  end if;
  for i in 0..25 loop
    n := (substring(bits from i * 5 + 1 for 5)::bit(5))::integer;
    out := out || substr(alph, n + 1, 1);
  end loop;
  return out;
end;
$$;

create function gift_private.redeem(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_hash bytea;
  v_id text;
  v_tier text;
  v_status text;
  v_name text;
  v_phone text;
  v_email text;
  v_addr1 text;
  v_line2 text;
  v_city text;
  v_postcode text;
  v_country text;
  new_id uuid;
begin
  if p is null or pg_catalog.octet_length(p::text) > 4000 then
    return jsonb_build_object('result', 'invalid_request');
  end if;
  if jsonb_typeof(p->'consent') is distinct from 'boolean'
     or (p->'consent') is distinct from 'true'::jsonb then
    return jsonb_build_object('result', 'invalid_request');
  end if;
  if coalesce(p->>'code_hash', '') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('result', 'invalid_request');
  end if;

  v_name := btrim(coalesce(p->>'recipient_name', ''));
  v_phone := btrim(coalesce(p->>'phone', ''));
  v_email := nullif(btrim(coalesce(p->>'email', '')), '');
  v_addr1 := btrim(coalesce(p->>'address1', ''));
  v_line2 := nullif(btrim(coalesce(p->>'address2', '')), '');
  v_city := btrim(coalesce(p->>'city', ''));
  v_postcode := btrim(coalesce(p->>'postcode', ''));
  v_country := upper(btrim(coalesce(p->>'country', '')));

  if char_length(v_name) not between 1 and 100
     or char_length(v_phone) not between 7 and 24
     or char_length(regexp_replace(v_phone, '[^0-9]', '', 'g')) not between 7 and 20
     or char_length(v_addr1) not between 1 and 120
     or char_length(v_city) not between 1 and 80
     or char_length(v_postcode) not between 1 and 16
     or v_country not in ('GB', 'CN', 'HK', 'MO', 'IE')
     or v_name ~ '[[:cntrl:]]'
     or v_phone ~ '[[:cntrl:]]'
     or v_addr1 ~ '[[:cntrl:]]'
     or v_city ~ '[[:cntrl:]]'
     or v_postcode ~ '[[:cntrl:]]'
     or (v_line2 is not null and (char_length(v_line2) > 120 or v_line2 ~ '[[:cntrl:]]'))
     or (v_email is not null and (
       char_length(v_email) > 254
       or v_email ~ '[[:cntrl:][:space:]]'
       or v_email !~ '^[^@]+@[^@]+\.[^@]+$'
     ))
  then
    return jsonb_build_object('result', 'invalid_request');
  end if;

  v_hash := pg_catalog.decode(p->>'code_hash', 'hex');

  select id, tier, status
    into v_id, v_tier, v_status
  from gift_private.vouchers
  where code_hash = v_hash
  for update;

  if not found or v_status is distinct from 'active' then
    return jsonb_build_object('result', 'invalid_or_used');
  end if;

  update gift_private.vouchers
     set status = 'consumed',
         consumed_at = pg_catalog.now()
   where id = v_id
     and status = 'active';

  if not found then
    return jsonb_build_object('result', 'invalid_or_used');
  end if;

  insert into gift_private.addresses (
    voucher_id, recipient_name, phone, email, address1, address2,
    city, postcode, country, consented_at
  ) values (
    v_id, v_name, v_phone, v_email, v_addr1, v_line2,
    v_city, v_postcode, v_country, pg_catalog.now()
  )
  returning id into new_id;

  return jsonb_build_object(
    'result', 'ok',
    'confirmation_id', new_id,
    'tier', v_tier
  );
exception
  when unique_violation then
    return jsonb_build_object('result', 'invalid_or_used');
end;
$$;

comment on function gift_private.redeem(jsonb) is
  'Consumes one active voucher and inserts one address. A second call does not add or overwrite. Grand ids GP01 and TP01 do not consume a standard voucher.';

create function public.gift_redeem(p jsonb)
returns jsonb
language sql
security invoker
set search_path = pg_catalog
as $$
  select gift_private.redeem(p);
$$;

comment on function public.gift_redeem(jsonb) is
  'Service-role wrapper used by the gift-submit edge function. Not granted to anon.';

create function gift_private.issue_batch(p_batch text)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_pepper text;
  v_ids text[];
  v_id text;
  v_code text;
  v_tier text;
  v_count integer := 0;
begin
  if p_batch is distinct from 'production' and p_batch is distinct from 'test' then
    raise exception 'bad batch';
  end if;
  v_pepper := current_setting('gift.voucher_pepper', true);
  if v_pepper is null or char_length(v_pepper) < 32 or v_pepper ~ '[[:space:]]' then
    raise exception 'voucher pepper is not set for this transaction';
  end if;

  if p_batch = 'production' then
    v_ids := array[
      'G01','G02','G03','G04','G05','G06','G07','G08','G09','G10',
      'G11','G12','G13','G14','G15','G16','G17','G18','G19','G20','GP01'
    ];
  else
    v_ids := array['T01','T02','T03','T04','T05','TP01'];
  end if;

  foreach v_id in array v_ids loop
    if exists (select 1 from gift_private.vouchers where id = v_id) then
      continue;
    end if;
    v_code := gift_private.encode_crockford(extensions.gen_random_bytes(16));
    v_tier := case when v_id in ('GP01', 'TP01') then 'grand' else 'standard' end;
    insert into gift_private.vouchers (id, batch, tier, code_hash)
    values (
      v_id,
      p_batch,
      v_tier,
      extensions.hmac(
        convert_to(v_code, 'UTF8'),
        convert_to(v_pepper, 'UTF8'),
        'sha256'
      )
    );
    insert into gift_private.distribution (voucher_id, plaintext_code)
    values (v_id, v_code);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

comment on function gift_private.issue_batch(text) is
  'Owner-only. Reads the transaction-local pepper, stores HMAC hashes, and parks plaintext in gift_private.distribution. Does not print codes. test does not insert G01-G20 or GP01.';

create function gift_private.distribution_list()
returns table (voucher_id text, batch text, tier text, canonical_code text, grouped_code text)
language sql
security definer
set search_path = pg_catalog
as $$
  select d.voucher_id,
         v.batch,
         v.tier,
         d.plaintext_code,
         substr(d.plaintext_code, 1, 4) || '-' || substr(d.plaintext_code, 5, 4) || '-' ||
         substr(d.plaintext_code, 9, 4) || '-' || substr(d.plaintext_code, 13, 4) || '-' ||
         substr(d.plaintext_code, 17, 4) || '-' || substr(d.plaintext_code, 21, 6)
  from gift_private.distribution d
  join gift_private.vouchers v on v.id = d.voucher_id
  order by v.batch, v.id;
$$;

comment on function gift_private.distribution_list() is
  'Owner-only export of plaintext codes still waiting to be cleared. Copy the result into a private store, never into git or chat.';

create function gift_private.clear_distribution()
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  removed integer;
begin
  delete from gift_private.distribution;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

comment on function gift_private.clear_distribution() is
  'Deletes parked plaintext codes after the owner has copied them. Does not delete vouchers or addresses.';

create function gift_private.distribution_pending()
returns integer
language sql
security definer
set search_path = pg_catalog
as $$
  select count(*)::integer from gift_private.distribution;
$$;

revoke all on function gift_private.encode_crockford(bytea) from public;
revoke all on function gift_private.redeem(jsonb) from public;
revoke all on function public.gift_redeem(jsonb) from public;
revoke all on function gift_private.issue_batch(text) from public;
revoke all on function gift_private.distribution_list() from public;
revoke all on function gift_private.clear_distribution() from public;
revoke all on function gift_private.distribution_pending() from public;

do $$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'service_role', 'authenticator'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('revoke all on schema gift_private from %I', role_name);
      execute format('revoke all on table gift_private.vouchers from %I', role_name);
      execute format('revoke all on table gift_private.addresses from %I', role_name);
      execute format('revoke all on table gift_private.distribution from %I', role_name);
      execute format('revoke all on function gift_private.encode_crockford(bytea) from %I', role_name);
      execute format('revoke all on function gift_private.redeem(jsonb) from %I', role_name);
      execute format('revoke all on function public.gift_redeem(jsonb) from %I', role_name);
      execute format('revoke all on function gift_private.issue_batch(text) from %I', role_name);
      execute format('revoke all on function gift_private.distribution_list() from %I', role_name);
      execute format('revoke all on function gift_private.clear_distribution() from %I', role_name);
      execute format('revoke all on function gift_private.distribution_pending() from %I', role_name);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema gift_private to service_role';
    execute 'grant execute on function gift_private.redeem(jsonb) to service_role';
    execute 'grant execute on function public.gift_redeem(jsonb) to service_role';
  end if;
end $$;
