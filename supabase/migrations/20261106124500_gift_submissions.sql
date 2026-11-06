-- Gift delivery details. Readable in the Supabase dashboard by the project owner.
-- The public anon key cannot read this table. Inserts go through gift_save_submission only.

create table if not exists gift_submissions (
  id uuid primary key default gen_random_uuid(),
  reference_code text not null,
  recipient_name text not null,
  phone text not null,
  address_line1 text not null,
  address_line2 text,
  city text not null,
  postcode text not null,
  country text not null,
  created_at timestamptz not null default now(),
  constraint gift_submissions_fields check (
    char_length(btrim(reference_code)) between 1 and 64
    and char_length(btrim(recipient_name)) between 1 and 100
    and char_length(btrim(phone)) between 7 and 24
    and char_length(btrim(address_line1)) between 1 and 120
    and (address_line2 is null or char_length(address_line2) <= 120)
    and char_length(btrim(city)) between 1 and 80
    and char_length(btrim(postcode)) between 1 and 16
    and country in ('GB', 'CN', 'HK', 'MO', 'IE')
  )
);

alter table gift_submissions enable row level security;
alter table gift_submissions force row level security;
revoke all on table gift_submissions from public;

create or replace function gift_save_submission(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  new_id uuid;
  line2 text;
begin
  if p is null or octet_length(p::text) > 4000 then
    raise exception 'bad submission';
  end if;
  line2 := nullif(btrim(p->>'address_line2'), '');
  insert into gift_submissions (
    reference_code, recipient_name, phone, address_line1, address_line2, city, postcode, country
  ) values (
    btrim(p->>'reference_code'),
    btrim(p->>'recipient_name'),
    btrim(p->>'phone'),
    btrim(p->>'address_line1'),
    line2,
    btrim(p->>'city'),
    btrim(p->>'postcode'),
    upper(btrim(p->>'country'))
  )
  returning id into new_id;
  return new_id;
end;
$$;

revoke all on function gift_save_submission(jsonb) from public;

do $$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('revoke all on table gift_submissions from %I', role_name);
      execute format('revoke all on function gift_save_submission(jsonb) from %I', role_name);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select on table gift_submissions to service_role';
    execute 'grant execute on function gift_save_submission(jsonb) to service_role';
  end if;
end $$;
