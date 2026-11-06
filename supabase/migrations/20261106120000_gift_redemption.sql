-- Thank-you gift redemption for 20 one-time codes.
-- Isolated from orders, course_codes and referral codes.
-- Plaintext codes are never stored. anon and authenticated have no privileges.
-- Apply in the existing Supabase project from TeaFairyWorld/teatok. Do not run
-- this against production from the website repository deploy.

create extension if not exists pgcrypto;

create table if not exists gift_campaign (
  id smallint primary key default 1,
  active boolean not null default false,
  redeem_deadline timestamptz,
  allowed_countries text[],
  retention_days integer not null default 90,
  ip_limit integer not null default 10,
  ip_window_seconds integer not null default 900,
  code_limit integer not null default 5,
  code_window_seconds integer not null default 3600,
  ip_day_limit integer not null default 30,
  updated_at timestamptz not null default now(),
  constraint gift_campaign_singleton check (id = 1),
  constraint gift_campaign_retention check (retention_days between 1 and 3650),
  constraint gift_campaign_limits check (
    ip_limit between 1 and 100
    and ip_window_seconds between 60 and 86400
    and code_limit between 1 and 30
    and code_window_seconds between 60 and 86400
    and ip_day_limit between 1 and 200
  )
);

insert into gift_campaign (id) values (1) on conflict (id) do nothing;

create table if not exists gift_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash bytea not null unique,
  status text not null default 'available',
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint gift_codes_status check (status in ('available', 'claimed', 'void')),
  constraint gift_codes_hash_len check (octet_length(code_hash) = 32)
);

create table if not exists gift_claims (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null unique references gift_codes (id),
  confirmation_ref text not null unique,
  recipient_name text not null,
  address_line1 text not null,
  address_line2 text,
  city text not null,
  postcode text not null,
  country text not null,
  phone text,
  email text,
  instructions text,
  consent_at timestamptz not null,
  status text not null default 'pending_shipment',
  carrier text,
  tracking_number text,
  shipped_at timestamptz,
  redacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gift_claims_status check (status in ('pending_shipment', 'shipped')),
  constraint gift_claims_ref check (confirmation_ref ~ '^TF-[0-9A-F]{8}$'),
  constraint gift_claims_country_fmt check (country ~ '^[A-Z]{2}$')
);

create table if not exists gift_rate_buckets (
  bucket text primary key,
  hits integer not null,
  updated_at timestamptz not null default now(),
  constraint gift_rate_hits_nonneg check (hits >= 0)
);

-- Real ISO 3166-1 alpha-2 codes. This is not a shipping allow-list.
create table if not exists gift_iso_country (
  code text primary key,
  constraint gift_iso_country_fmt check (code ~ '^[A-Z]{2}$')
);

insert into gift_iso_country (code)
select distinct token
from regexp_split_to_table(
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW',
  '\s+'
) as token
where token ~ '^[A-Z]{2}$'
on conflict (code) do nothing;

alter table gift_campaign enable row level security;
alter table gift_codes enable row level security;
alter table gift_claims enable row level security;
alter table gift_rate_buckets enable row level security;
alter table gift_iso_country enable row level security;

alter table gift_campaign force row level security;
alter table gift_codes force row level security;
alter table gift_claims force row level security;
alter table gift_rate_buckets force row level security;
alter table gift_iso_country force row level security;

revoke all on gift_campaign, gift_codes, gift_claims, gift_rate_buckets, gift_iso_country from public;

comment on table gift_claims is 'Delivery details for TeaFairy thank-you gifts. No anon or authenticated access.';
comment on table gift_codes is 'HMAC-SHA256 of gift codes. Plaintext codes are not stored.';

create or replace function gift_rate_hit(p_bucket text, p_limit integer)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  n integer;
begin
  if p_bucket is null or length(p_bucket) < 16 or length(p_bucket) > 220 then
    raise exception 'bad bucket';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'bad limit';
  end if;
  insert into gift_rate_buckets as b (bucket, hits)
  values (p_bucket, 1)
  on conflict (bucket) do update
    set hits = b.hits + 1,
        updated_at = now()
  returning hits into n;
  delete from gift_rate_buckets where updated_at < now() - interval '2 days';
  return n;
end;
$$;

create or replace function gift_service_config()
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'active', active,
    'redeem_deadline', redeem_deadline,
    'allowed_countries', to_jsonb(allowed_countries),
    'retention_days', retention_days,
    'ip_limit', ip_limit,
    'ip_window_seconds', ip_window_seconds,
    'code_limit', code_limit,
    'code_window_seconds', code_window_seconds,
    'ip_day_limit', ip_day_limit
  )
  from gift_campaign
  where id = 1;
$$;

create or replace function gift_try_claim(p_code_hash bytea, p_claim jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_campaign gift_campaign%rowtype;
  v_code gift_codes%rowtype;
  v_name text;
  v_line1 text;
  v_line2 text;
  v_city text;
  v_postcode text;
  v_country text;
  v_phone text;
  v_email text;
  v_instructions text;
  v_ref text;
  v_id uuid;
begin
  if p_code_hash is null or octet_length(p_code_hash) <> 32 then
    return jsonb_build_object('result', 'rejected');
  end if;
  if p_claim is null or octet_length(p_claim::text) > 8000 then
    return jsonb_build_object('result', 'invalid_details', 'fields', jsonb_build_object('recipient_name', 'invalid'));
  end if;

  select * into v_campaign from gift_campaign where id = 1;
  if not found or v_campaign.active is not true then
    return jsonb_build_object('result', 'closed');
  end if;
  if v_campaign.redeem_deadline is not null and v_campaign.redeem_deadline <= now() then
    return jsonb_build_object('result', 'rejected');
  end if;

  select * into v_code
  from gift_codes
  where code_hash = p_code_hash
  for update;
  if not found or v_code.status <> 'available' then
    return jsonb_build_object('result', 'rejected');
  end if;

  if coalesce((p_claim ->> 'consent')::boolean, false) is not true then
    return jsonb_build_object('result', 'invalid_details', 'fields', jsonb_build_object('consent', 'required'));
  end if;

  v_name := btrim(p_claim ->> 'recipient_name');
  v_line1 := btrim(p_claim ->> 'address_line1');
  v_line2 := nullif(btrim(p_claim ->> 'address_line2'), '');
  v_city := btrim(p_claim ->> 'city');
  v_postcode := btrim(p_claim ->> 'postcode');
  v_country := upper(btrim(coalesce(p_claim ->> 'country', '')));
  v_phone := nullif(btrim(p_claim ->> 'phone'), '');
  v_email := nullif(btrim(p_claim ->> 'email'), '');
  v_instructions := nullif(btrim(p_claim ->> 'instructions'), '');

  if v_name is null or char_length(v_name) < 1 or char_length(v_name) > 100
     or v_name ~ E'[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]'
     or v_name ~ '^[[:digit:][:space:][:punct:]]+$' then
    return jsonb_build_object('result', 'invalid_details', 'fields', jsonb_build_object('recipient_name', 'invalid'));
  end if;
  if v_line1 is null or char_length(v_line1) < 1 or char_length(v_line1) > 120
     or v_line1 ~ E'[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]' then
    return jsonb_build_object('result', 'invalid_details', 'fields', jsonb_build_object('address_line1', 'invalid'));
  end if;
  if v_line2 is not null and (char_length(v_line2) > 120 or v_line2 ~ E'[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]') then
    return jsonb_build_object('result', 'invalid_details', 'fields', jsonb_build_object('address_line2', 'invalid'));
  end if;
  if v_city is null or char_length(v_city) < 1 or char_length(v_city) > 80
     or v_city ~ E'[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]' then
    return jsonb_build_object('result', 'invalid_details', 'fields', jsonb_build_object('city', 'invalid'));
  end if;
  if v_postcode is null or char_length(v_postcode) < 1 or char_length(v_postcode) > 16
     or v_postcode ~ E'[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]' then
    return jsonb_build_object('result', 'invalid_details', 'fields', jsonb_build_object('postcode', 'invalid'));
  end if;
  if v_country !~ '^[A-Z]{2}$' or not exists (select 1 from gift_iso_country where code = v_country) then
    return jsonb_build_object('result', 'invalid_details', 'fields', jsonb_build_object('country', 'invalid'));
  end if;
  if v_campaign.allowed_countries is not null and not (v_country = any (v_campaign.allowed_countries)) then
    return jsonb_build_object('result', 'invalid_details', 'fields', jsonb_build_object('country', 'unavailable'));
  end if;
  if v_phone is null or (
    char_length(v_phone) > 24
    or v_phone ~ '[^0-9+(). -]'
    or length(regexp_replace(v_phone, '\D', '', 'g')) < 7
    or length(regexp_replace(v_phone, '\D', '', 'g')) > 20
  ) then
    return jsonb_build_object('result', 'invalid_details', 'fields', jsonb_build_object('phone', 'invalid'));
  end if;
  if v_email is not null and (
    char_length(v_email) > 254
    or v_email ~ '[[:cntrl:]]'
    or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ) then
    return jsonb_build_object('result', 'invalid_details', 'fields', jsonb_build_object('email', 'invalid'));
  end if;
  if v_instructions is not null and (
    char_length(v_instructions) > 400
    or v_instructions ~ E'[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]'
  ) then
    return jsonb_build_object('result', 'invalid_details', 'fields', jsonb_build_object('instructions', 'invalid'));
  end if;

  update gift_codes
     set status = 'claimed',
         claimed_at = now()
   where id = v_code.id
     and status = 'available';
  if not found then
    return jsonb_build_object('result', 'rejected');
  end if;

  loop
    v_ref := 'TF-' || upper(encode(gen_random_bytes(4), 'hex'));
    begin
      insert into gift_claims (
        code_id, confirmation_ref, recipient_name, address_line1, address_line2,
        city, postcode, country, phone, email, instructions, consent_at, status
      ) values (
        v_code.id, v_ref, v_name, v_line1, v_line2,
        v_city, v_postcode, v_country, v_phone, v_email, v_instructions, now(), 'pending_shipment'
      )
      returning id into v_id;
      exit;
    exception
      when unique_violation then
        if exists (select 1 from gift_claims where code_id = v_code.id) then
          raise;
        end if;
    end;
  end loop;

  return jsonb_build_object(
    'result', 'ok',
    'confirmation_ref', v_ref,
    'claim_id', v_id,
    'status', 'pending_shipment'
  );
end;
$$;

create or replace function gift_admin_list()
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    (
      select jsonb_agg(to_jsonb(s) order by s.created_at desc)
      from (
        select
          id,
          confirmation_ref,
          recipient_name,
          address_line1,
          address_line2,
          city,
          postcode,
          country,
          phone,
          email,
          instructions,
          status,
          carrier,
          tracking_number,
          shipped_at,
          redacted_at,
          consent_at,
          created_at
        from gift_claims
      ) s
    ),
    '[]'::jsonb
  );
$$;

create or replace function gift_admin_mark_shipped(p_id uuid, p_carrier text, p_tracking text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  r gift_claims%rowtype;
begin
  if p_carrier is not null and (char_length(btrim(p_carrier)) > 80 or p_carrier ~ '[[:cntrl:]]') then
    return jsonb_build_object('ok', false, 'error', 'invalid_carrier');
  end if;
  if p_tracking is not null and (char_length(btrim(p_tracking)) > 80 or p_tracking ~ '[[:cntrl:]]') then
    return jsonb_build_object('ok', false, 'error', 'invalid_tracking');
  end if;

  update gift_claims
     set status = 'shipped',
         shipped_at = coalesce(shipped_at, now()),
         carrier = coalesce(nullif(btrim(p_carrier), ''), carrier),
         tracking_number = coalesce(nullif(btrim(p_tracking), ''), tracking_number),
         updated_at = now()
   where id = p_id
     and redacted_at is null
  returning * into r;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'id', r.id, 'status', r.status, 'shipped_at', r.shipped_at);
end;
$$;

create or replace function gift_admin_redact_due()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  n integer;
  days integer;
begin
  select retention_days into days from gift_campaign where id = 1;
  update gift_claims
     set recipient_name = '',
         address_line1 = '',
         address_line2 = null,
         city = '',
         postcode = '',
         country = 'XX',
         phone = null,
         email = null,
         instructions = null,
         carrier = null,
         tracking_number = null,
         redacted_at = now(),
         updated_at = now()
   where status = 'shipped'
     and redacted_at is null
     and shipped_at <= now() - make_interval(days => days);
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function gift_admin_set_campaign(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v gift_campaign%rowtype;
  c text;
  countries text[] := array[]::text[];
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'bad patch';
  end if;
  select * into v from gift_campaign where id = 1 for update;

  if p_patch ? 'active' then
    if jsonb_typeof(p_patch -> 'active') <> 'boolean' then
      raise exception 'bad active';
    end if;
    v.active := (p_patch ->> 'active')::boolean;
  end if;

  if p_patch ? 'redeem_deadline' then
    if jsonb_typeof(p_patch -> 'redeem_deadline') = 'null' then
      v.redeem_deadline := null;
    else
      v.redeem_deadline := (p_patch ->> 'redeem_deadline')::timestamptz;
    end if;
  end if;

  if p_patch ? 'allowed_countries' then
    if jsonb_typeof(p_patch -> 'allowed_countries') = 'null' then
      v.allowed_countries := null;
    elsif jsonb_typeof(p_patch -> 'allowed_countries') <> 'array' then
      raise exception 'bad countries';
    else
      for c in select jsonb_array_elements_text(p_patch -> 'allowed_countries') loop
        c := upper(btrim(c));
        if c !~ '^[A-Z]{2}$' or not exists (select 1 from gift_iso_country where code = c) then
          raise exception 'bad country code';
        end if;
        countries := countries || c;
      end loop;
      if cardinality(countries) = 0 then
        v.allowed_countries := null;
      elsif cardinality(countries) > 60 then
        raise exception 'too many countries';
      else
        select array(select distinct x from unnest(countries) as x order by x) into v.allowed_countries;
      end if;
    end if;
  end if;

  if p_patch ? 'retention_days' then
    v.retention_days := (p_patch ->> 'retention_days')::integer;
  end if;
  if p_patch ? 'ip_limit' then
    v.ip_limit := (p_patch ->> 'ip_limit')::integer;
  end if;
  if p_patch ? 'ip_window_seconds' then
    v.ip_window_seconds := (p_patch ->> 'ip_window_seconds')::integer;
  end if;
  if p_patch ? 'code_limit' then
    v.code_limit := (p_patch ->> 'code_limit')::integer;
  end if;
  if p_patch ? 'code_window_seconds' then
    v.code_window_seconds := (p_patch ->> 'code_window_seconds')::integer;
  end if;
  if p_patch ? 'ip_day_limit' then
    v.ip_day_limit := (p_patch ->> 'ip_day_limit')::integer;
  end if;

  update gift_campaign
     set active = v.active,
         redeem_deadline = v.redeem_deadline,
         allowed_countries = v.allowed_countries,
         retention_days = v.retention_days,
         ip_limit = v.ip_limit,
         ip_window_seconds = v.ip_window_seconds,
         code_limit = v.code_limit,
         code_window_seconds = v.code_window_seconds,
         ip_day_limit = v.ip_day_limit,
         updated_at = now()
   where id = 1;

  return gift_service_config();
end;
$$;

create or replace function gift_provision_hashes(p_hashes bytea[])
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  h bytea;
  inserted integer := 0;
  inserted_now integer;
  total integer;
begin
  if p_hashes is null or cardinality(p_hashes) < 1 or cardinality(p_hashes) > 20 then
    raise exception 'expected between 1 and 20 hashes';
  end if;
  foreach h in array p_hashes loop
    if h is null or octet_length(h) <> 32 then
      raise exception 'hash must be 32 bytes';
    end if;
    insert into gift_codes (code_hash) values (h)
    on conflict (code_hash) do nothing;
    get diagnostics inserted_now = row_count;
    inserted := inserted + inserted_now;
  end loop;
  select count(*) into total from gift_codes;
  if total > 20 then
    raise exception 'gift code cap is 20';
  end if;
  return jsonb_build_object('inserted', inserted, 'total', total);
end;
$$;

create or replace function gift_provision_hex(p_hashes text[])
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  t text;
  hashes bytea[] := array[]::bytea[];
begin
  if p_hashes is null then
    raise exception 'expected between 1 and 20 hashes';
  end if;
  foreach t in array p_hashes loop
    if t is null or t !~ '^[0-9a-fA-F]{64}$' then
      raise exception 'hash must be 64 hex characters';
    end if;
    hashes := hashes || decode(t, 'hex');
  end loop;
  return gift_provision_hashes(hashes);
end;
$$;

create or replace function gift_admin_void_hash(p_code_hash bytea)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_code_hash is null or octet_length(p_code_hash) <> 32 then
    return jsonb_build_object('ok', false);
  end if;
  update gift_codes
     set status = 'void'
   where code_hash = p_code_hash
     and status = 'available';
  if not found then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

do $$
declare
  fn text;
  rel text;
  role_name text;
  funs text[] := array[
    'gift_rate_hit(text, integer)',
    'gift_service_config()',
    'gift_try_claim(bytea, jsonb)',
    'gift_admin_list()',
    'gift_admin_mark_shipped(uuid, text, text)',
    'gift_admin_redact_due()',
    'gift_admin_set_campaign(jsonb)',
    'gift_provision_hashes(bytea[])',
    'gift_provision_hex(text[])',
    'gift_admin_void_hash(bytea)'
  ];
  rels text[] := array[
    'gift_campaign',
    'gift_codes',
    'gift_claims',
    'gift_rate_buckets',
    'gift_iso_country'
  ];
begin
  foreach fn in array funs loop
    execute format('revoke all on function %s from public', fn);
    foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then
        execute format('revoke all on function %s from %I', fn, role_name);
      end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', fn);
    end if;
  end loop;

  foreach rel in array rels loop
    execute format('revoke all on table %I from public', rel);
    foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then
        execute format('revoke all on table %I from %I', rel, role_name);
      end if;
    end loop;
  end loop;
end;
$$;
