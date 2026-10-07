-- SAPI 23 (#305): what a shopper pays for delivery before checkout (DATA-MODEL §7.2; SetOps Shipping), several methods
-- at once (#337), and the couriers a store uses on its partner's own accounts (THIRD-PARTY-ACCESS §3.2, §4).

create table store_shipping (
  store_id uuid primary key references store (id),
  courier_enabled boolean not null default false,
  flat_enabled boolean not null default false,
  -- Money in `currency`, the pricing currency when saved; a market may charge its own (market.delivery_amount).
  flat_amount bigint check (flat_amount between 0 and 1000000000000),
  pickup_enabled boolean not null default false,
  pickup_hours text check (char_length(pickup_hours) between 1 and 120),
  free_mode text not null default 'never' check (free_mode in ('never', 'always', 'over')),
  free_threshold_amount bigint check (free_threshold_amount between 1 and 1000000000000),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  area_mode text not null default 'everywhere' check (area_mode in ('everywhere', 'list')),
  area_file_name text check (char_length(area_file_name) between 1 and 200),
  -- The Home checklist's "Set up shipping" (PortalHome): the first save.
  saved_at timestamptz,
  revision integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint store_shipping_flat check (not flat_enabled or flat_amount is not null),
  constraint store_shipping_pickup check (not pickup_enabled or pickup_hours is not null),
  constraint store_shipping_free check ((free_mode = 'over') = (free_threshold_amount is not null))
);

-- "Only postcodes I upload": the codes in the store's own country, normalised (engine/modules/shipping).
create table delivery_postal_code (
  store_id uuid not null references store (id),
  code text not null check (code ~ '^[A-Z0-9]{3,10}$'),
  primary key (store_id, code)
);

-- The couriers a store uses, each through its partner's account: Shiprocket, or USPS, UPS and FedEx through EasyPost.
create table store_courier (
  store_id uuid not null references store (id),
  provider text not null check (provider in ('shiprocket', 'usps', 'ups', 'fedex')),
  role text not null default 'off' check (role in ('pricing', 'standby', 'off')),
  pickup_mode text not null default 'scheduled' check (pickup_mode in ('scheduled', 'on_request')),
  label_size text not null check (label_size in ('a6', 'a4', '4x6', 'letter')),
  tracking_emails boolean not null default true,
  position integer not null default 0 check (position >= 0),
  last_tested_at timestamptz,
  -- ok, rejected (the account's login refused), unavailable (no answer) or unserved (no rate for the test parcel).
  last_test_result text check (last_test_result in ('ok', 'rejected', 'unavailable', 'unserved')),
  updated_at timestamptz not null default now(),
  primary key (store_id, provider)
);
create unique index store_courier_pricing_key on store_courier (store_id) where role = 'pricing';

-- SetMarkets' "Delivery charge": a market's own flat rate in its currency; null is the store's.
alter table market add column delivery_amount bigint check (delivery_amount between 0 and 1000000000000);

-- A market that follows the pricing currency to another currency drops its charge, money in the old one.
create or replace function store_markets_follow_currency() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update market set currency = new.pricing_currency, delivery_amount = null, revision = revision + 1, updated_at = now()
  where store_id = new.id and deleted_at is null and (currency = old.pricing_currency or (old.pricing_currency is null and is_primary));
  return new;
end
$$;
grant update (delivery_amount) on market to app_definer;

-- Whether the store delivers to a postcode, without reading its list: a shopper's quote asks this and never sees the
-- list itself (DATA-MODEL §7.11: delivery-area checks are the engine's).
create function store_delivers_to(code text) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app_setting_text('app.scope') in ('store', 'shop') and app_setting_text('app.seller_id') = ''
    and exists (select 1 from delivery_postal_code d where d.store_id = app_setting_uuid('app.store_id') and d.code = store_delivers_to.code)
$$;
grant select on delivery_postal_code to app_definer;
alter function store_delivers_to(text) owner to app_definer;
revoke execute on function store_delivers_to(text) from public;
grant execute on function store_delivers_to(text) to app_request;

grant select, insert, update on store_shipping, store_courier to app_request;
grant select, insert, delete on delivery_postal_code to app_request;
grant select, insert, update, delete on store_shipping, delivery_postal_code, store_courier to app_system;

do $$
declare
  t text;
begin
  foreach t in array array['store_shipping', 'delivery_postal_code', 'store_courier'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %I on %I for all to app_system using (true) with check (true)', t || '_system', t);
    execute format('create policy %I on %I for all to app_request
      using (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'') and app_setting_text(''app.seller_id'') = '''')
      with check (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'') and app_setting_text(''app.seller_id'') = '''')', t || '_merchant', t);
    execute format('create policy request_scope on %I as restrictive for all to app_request
      using (app_setting_text(''app.scope'') in (''store'', ''shop'', ''partner'', ''platform''))
      with check (app_setting_text(''app.scope'') in (''store'', ''shop'', ''partner'', ''platform''))', t);
    execute format('create policy partner_scope on %I as restrictive for all to app_partner using (false) with check (false)', t);
    execute format('create policy platform_scope on %I as restrictive for all to app_platform using (false) with check (false)', t);
    execute format('create policy system_scope on %I as restrictive for all to app_system
      using (app_setting_text(''app.scope'') = ''system'') with check (app_setting_text(''app.scope'') = ''system'')', t);
    execute format('create policy support_no_insert on %I as restrictive for insert to app_request with check (app_setting_text(''app.support'') <> ''read'')', t);
    execute format('create policy support_no_update on %I as restrictive for update to app_request with check (app_setting_text(''app.support'') <> ''read'')', t);
    execute format('create policy support_no_delete on %I as restrictive for delete to app_request using (app_setting_text(''app.support'') <> ''read'')', t);
  end loop;
end
$$;
