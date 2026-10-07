-- SAPI 9 (#308), part 1: carts and checkout up to payment (DATA-MODEL §7.6, §7.11). A cart is an order in state `cart`
-- that holds only what the shopper chose; the engine prices it on every read and stores money at placement (SAPI 10).

create table "order" (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  state text not null default 'cart' check (state in ('cart', 'placed', 'cancelled')),
  payment_state text not null default 'pending' check (payment_state in ('pending', 'authorised', 'paid', 'partly_refunded', 'refunded')),
  fulfilment_state text not null default 'unfulfilled' check (fulfilment_state in ('unfulfilled', 'partly_fulfilled', 'fulfilled')),
  customer_id uuid references customer (id),
  email text check (char_length(email) <= 254),
  phone text check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  language text,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  market_id uuid,
  shipping_address jsonb check (jsonb_typeof(shipping_address) = 'object'),
  billing_address jsonb check (jsonb_typeof(billing_address) = 'object'),
  -- The delivery option chosen at checkout (SAPI 23's quote): courier, flat or pickup.
  shipping_option text check (shipping_option in ('courier', 'flat', 'pickup')),
  shopper_note text check (char_length(shopper_note) <= 1000),
  checkout_step text check (checkout_step in ('contact', 'ship', 'pay')),
  cart_expires_at timestamptz,
  -- A guest's cart is theirs by the token the Shop API handed them, hashed; compared in policy, never selected (§5.3).
  access_token_hash text check (access_token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  foreign key (market_id, store_id) references market (id, store_id),
  constraint order_cart_owner check (state <> 'cart' or customer_id is not null or access_token_hash is not null)
);
create unique index order_id_store_key on "order" (id, store_id);
create index order_store_state_idx on "order" (store_id, state, updated_at desc);
create index order_customer_idx on "order" (customer_id, state) where customer_id is not null;
create index order_token_idx on "order" (access_token_hash) where access_token_hash is not null;

-- What a cart holds: a version and how many, nothing priced (order_line is the priced snapshot, written at placement).
create table cart_line (
  order_id uuid not null,
  store_id uuid not null,
  version_id uuid not null,
  quantity integer not null check (quantity between 1 and 999),
  added_at timestamptz not null default now(),
  primary key (order_id, version_id),
  foreign key (order_id, store_id) references "order" (id, store_id) on delete cascade,
  foreign key (version_id, store_id) references product_version (id, store_id)
);

-- The hash a guest's new cart must carry: the one this request presented, null when it presented none.
create function current_order_token_hash() returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(app_setting_text('app.order_token_hash'), '')
$$;
alter function current_order_token_hash() owner to app_definer;
revoke execute on function current_order_token_hash() from public;
grant execute on function current_order_token_hash() to app_shop;

-- The merchant side reads carts (Abandoned carts, SAPI 15) and orders (SAPI 11); a supplier never reads either.
grant select (id, store_id, state, payment_state, fulfilment_state, customer_id, email, phone, language, currency, market_id,
  shipping_address, billing_address, shipping_option, shopper_note, checkout_step, cart_expires_at, created_at, updated_at, revision) on "order" to app_request;
grant select on cart_line to app_request;
grant select, insert, update, delete on "order", cart_line to app_system;

-- A shopper writes only what it chose, on its own carts (§7.11): never the states, never another shopper's.
grant select (id, store_id, state, payment_state, fulfilment_state, customer_id, email, phone, language, currency, market_id,
  shipping_address, billing_address, shipping_option, shopper_note, checkout_step, cart_expires_at, created_at, updated_at, revision) on "order" to app_shop;
grant insert (store_id, customer_id, email, phone, language, currency, market_id, cart_expires_at, access_token_hash) on "order" to app_shop;
grant update (customer_id, email, phone, language, currency, market_id, shipping_address, billing_address, shipping_option, shopper_note,
  checkout_step, cart_expires_at, updated_at, revision) on "order" to app_shop;
grant select, insert, update, delete on cart_line to app_shop;

alter table "order" enable row level security;
alter table "order" force row level security;
alter table cart_line enable row level security;
alter table cart_line force row level security;

create policy order_system on "order" for all to app_system using (true) with check (true);
create policy order_merchant on "order" for select to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '');
-- A shopper's own: by its account, or a guest's by the token it presented (§7.11's shop branch). The policy compares the
-- hash itself, which no request role may select; a function looking the row up couldn't see one this statement inserts.
create policy order_shop_read on "order" for select to app_shop
using (app_setting_text('app.scope') = 'shop' and store_id = app_setting_uuid('app.store_id')
  and (customer_id = app_setting_uuid('app.customer_id') or (customer_id is null and access_token_hash = current_order_token_hash())));
-- A currency and market only of the store's offer, as its shop policies show them (§7.11): never one a storefront invents.
create policy order_shop_insert on "order" for insert to app_shop
with check (app_setting_text('app.scope') = 'shop' and store_id = app_setting_uuid('app.store_id') and state = 'cart'
  and (customer_id = app_setting_uuid('app.customer_id') or (customer_id is null and access_token_hash = current_order_token_hash()))
  and currency in (select s.pricing_currency::text from store s union all select c.currency::text from store_currency c)
  and (market_id is null or market_id in (select m.id from market m)));
-- A guest's cart may be claimed by the account it signs into (its customer_id set to its own), never by anyone else.
create policy order_shop_update on "order" for update to app_shop
using (app_setting_text('app.scope') = 'shop' and store_id = app_setting_uuid('app.store_id') and state = 'cart'
  and (customer_id = app_setting_uuid('app.customer_id') or (customer_id is null and access_token_hash = current_order_token_hash())))
with check (app_setting_text('app.scope') = 'shop' and store_id = app_setting_uuid('app.store_id') and state = 'cart'
  and (customer_id = app_setting_uuid('app.customer_id') or (customer_id is null and access_token_hash = current_order_token_hash()))
  and currency in (select s.pricing_currency::text from store s union all select c.currency::text from store_currency c)
  and (market_id is null or market_id in (select m.id from market m)));

create policy cart_line_system on cart_line for all to app_system using (true) with check (true);
create policy cart_line_merchant on cart_line for select to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '');
-- Through the cart's own policy: a line is the shopper's while its cart is, and is written only while it is a cart.
create policy cart_line_shop on cart_line for all to app_shop
using (app_setting_text('app.scope') = 'shop' and store_id = app_setting_uuid('app.store_id')
  and exists (select 1 from "order" o where o.id = order_id and o.state = 'cart'))
with check (app_setting_text('app.scope') = 'shop' and store_id = app_setting_uuid('app.store_id')
  and exists (select 1 from "order" o where o.id = order_id and o.state = 'cart'));

do $$
declare
  t text;
begin
  foreach t in array array['order', 'cart_line'] loop
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

-- Pricing a cart for its shopper (#308): the store's tax facts are public on every invoice, so the shop reads them, and
-- each version's tax class; the tax itself stays the engine's (DATA-MODEL §7.11, amended here).
grant select (id, store_id, name, tax_code, is_default, position, created_at, deleted_at) on tax_class to app_shop;
grant select (id, store_id, name, countries, regions, created_at) on tax_zone to app_shop;
grant select (id, store_id, tax_class_id, tax_zone_id, rate_bps, valid_from) on tax_rate to app_shop;
grant select (tax_class_id) on product_version to app_shop;
create policy tax_class_shop on tax_class for select to app_shop
using (app_setting_text('app.scope') = 'shop' and store_id = app_setting_uuid('app.store_id') and deleted_at is null);
create policy tax_zone_shop on tax_zone for select to app_shop using (app_setting_text('app.scope') = 'shop' and store_id = app_setting_uuid('app.store_id'));
create policy tax_rate_shop on tax_rate for select to app_shop using (app_setting_text('app.scope') = 'shop' and store_id = app_setting_uuid('app.store_id'));
do $$
declare
  pin record;
begin
  for pin in
    select tablename, roles, qual, with_check from pg_policies
    where schemaname = 'public' and policyname = 'request_scope' and tablename in ('tax_class', 'tax_zone', 'tax_rate')
  loop
    execute format('alter policy request_scope on %I to %s using ((%s) and (current_user <> ''app_shop'' or app_setting_text(''app.scope'') = ''shop'')) with check ((%s) and (current_user <> ''app_shop'' or app_setting_text(''app.scope'') = ''shop''))',
      pin.tablename, (select string_agg(format('%I', r), ', ') from unnest(array_append(pin.roles::text[], 'app_shop')) r), pin.qual, coalesce(pin.with_check, pin.qual));
  end loop;
end
$$;
