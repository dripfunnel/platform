-- SAPI 9 (#308), part 2: shopper accounts (ACCESS §2.1; DATA-MODEL §3.4, §7.5): how a store's shoppers sign in, their
-- sessions, the codes that prove an email or a number, and their saved addresses.

-- Settings › Customer accounts (SetAccess): email and password, mobile and a code, or both; India starts with both.
create table store_customer_auth (
  store_id uuid primary key references store (id),
  email_enabled boolean not null,
  phone_enabled boolean not null,
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  constraint store_customer_auth_some check (email_enabled or phone_enabled)
);
insert into store_customer_auth (store_id, email_enabled, phone_enabled) select id, true, country = 'IN' from store;
create function store_default_customer_auth() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into store_customer_auth (store_id, email_enabled, phone_enabled) values (new.id, true, new.country is not distinct from 'IN');
  return new;
end
$$;
grant insert on store_customer_auth to app_definer;
alter function store_default_customer_auth() owner to app_definer;
create trigger store_default_customer_auth after insert on store for each row execute function store_default_customer_auth();

-- A shopper's signed-in session: the token hashed, kept 30 days from the last use.
create table customer_session (
  id_hash text primary key check (id_hash ~ '^[0-9a-f]{64}$'),
  store_id uuid not null references store (id),
  customer_id uuid not null references customer (id),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz
);
create index customer_session_customer_idx on customer_session (customer_id) where ended_at is null;

-- A 6-digit code proving an email or a number; hashed, short-lived and attempt-counted (ACCESS §2.1).
create table customer_code (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  channel text not null check (channel in ('email', 'phone')),
  target text not null check (char_length(target) between 3 and 320),
  code_hash text check (code_hash ~ '^[0-9a-f]{64}$'),
  attempts integer not null default 0 check (attempts between 0 and 100),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index customer_code_target_idx on customer_code (store_id, channel, target, created_at desc);

create table customer_address (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customer (id),
  store_id uuid not null references store (id),
  name text not null check (char_length(name) between 1 and 200),
  line1 text not null check (char_length(line1) between 1 and 200),
  line2 text check (char_length(line2) <= 200),
  city text not null check (char_length(city) between 1 and 200),
  region text check (char_length(region) <= 200),
  postal_code text check (char_length(postal_code) <= 20),
  country text not null check (country ~ '^[A-Z]{2}$'),
  phone text check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  is_default_shipping boolean not null default false,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index customer_address_customer_idx on customer_address (customer_id) where deleted_at is null;
create unique index customer_address_default_key on customer_address (customer_id) where is_default_shipping and deleted_at is null;

-- Sign-in, codes and sessions run in system scope before any shopper exists (auth/shopperAuth.ts), as a merchant's do.
grant select, insert, update on store_customer_auth to app_system;
grant select, insert, update, delete on customer_session, customer_code to app_system;
grant select, insert, update, delete on customer_address to app_system;
-- The merchant reads and sets its store's choice (settings); never a session or a code.
grant select, insert, update on store_customer_auth to app_request;
grant select (id, customer_id, store_id, name, line1, line2, city, region, postal_code, country, phone, is_default_shipping, created_at, deleted_at) on customer_address to app_request;
-- A shopper reads its store's choice, and keeps its own name and addresses.
grant select (store_id, email_enabled, phone_enabled) on store_customer_auth to app_shop;
grant select (id, customer_id, store_id, name, line1, line2, city, region, postal_code, country, phone, is_default_shipping, created_at, deleted_at) on customer_address to app_shop;
grant insert (customer_id, store_id, name, line1, line2, city, region, postal_code, country, phone, is_default_shipping) on customer_address to app_shop;
grant update (name, line1, line2, city, region, postal_code, country, phone, is_default_shipping, deleted_at) on customer_address to app_shop;
grant update (name) on customer to app_shop;
-- The account events a shopper's own writes record (LOGGING §3: an address added, changed or removed), and only those:
-- about itself, as itself, in its own store.
grant insert on activity_log to app_shop;
create policy activity_log_shop_insert on activity_log for insert to app_shop
with check (app_setting_text('app.scope') = 'shop' and store_id = app_setting_uuid('app.store_id') and partner_id = app_setting_uuid('app.partner_id')
  and seller_id is null and app_setting_text('app.customer_id') <> '' and customer_id = app_setting_uuid('app.customer_id')
  and actor_kind = 'customer' and actor_id = app_setting_text('app.customer_id'));

do $$
declare
  t text;
begin
  foreach t in array array['store_customer_auth', 'customer_session', 'customer_code', 'customer_address'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %I on %I for all to app_system using (true) with check (true)', t || '_system', t);
    execute format('create policy request_scope on %I as restrictive for all to app_request, app_shop
      using (app_setting_text(''app.scope'') in (''store'', ''shop'', ''partner'', ''platform'') and (current_user <> ''app_shop'' or app_setting_text(''app.scope'') = ''shop''))
      with check (app_setting_text(''app.scope'') in (''store'', ''shop'', ''partner'', ''platform'') and (current_user <> ''app_shop'' or app_setting_text(''app.scope'') = ''shop''))', t);
    execute format('create policy partner_scope on %I as restrictive for all to app_partner using (false) with check (false)', t);
    execute format('create policy platform_scope on %I as restrictive for all to app_platform using (false) with check (false)', t);
    execute format('create policy system_scope on %I as restrictive for all to app_system
      using (app_setting_text(''app.scope'') = ''system'') with check (app_setting_text(''app.scope'') = ''system'')', t);
  end loop;
end
$$;

create policy store_customer_auth_merchant on store_customer_auth for all to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '')
with check (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '' and app_setting_text('app.support') <> 'read');
create policy store_customer_auth_shop on store_customer_auth for select to app_shop
using (app_setting_text('app.scope') = 'shop' and store_id = app_setting_uuid('app.store_id'));
create policy customer_address_merchant on customer_address for select to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '');
-- A shopper's own addresses only, in its own store.
create policy customer_address_shop on customer_address for all to app_shop
using (app_setting_text('app.scope') = 'shop' and store_id = app_setting_uuid('app.store_id') and customer_id = app_setting_uuid('app.customer_id'))
with check (app_setting_text('app.scope') = 'shop' and store_id = app_setting_uuid('app.store_id') and customer_id = app_setting_uuid('app.customer_id'));
-- Sign-in makes and proves accounts in system scope, which had no branch on customer before.
create policy customer_system on customer for all to app_system using (true) with check (true);
-- A shopper changes its own name, nothing else of its row (the grant is by column).
create policy customer_shop_update on customer for update to app_shop
using (app_setting_text('app.scope') = 'shop' and store_id = app_setting_uuid('app.store_id') and id = app_setting_uuid('app.customer_id'))
with check (app_setting_text('app.scope') = 'shop' and store_id = app_setting_uuid('app.store_id') and id = app_setting_uuid('app.customer_id'));
