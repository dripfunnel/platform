-- SAPI 10 (#309), part 1: placing an order and paying for it (DATA-MODEL §7.6; PLATFORM-PROMPT §5.4). Placement snapshots
-- the cart the engine priced into lines, parts and adjustments, numbers it, and records how it will be paid.

alter table "order"
  add column number text check (char_length(number) between 1 and 40),
  add column placed_at timestamptz,
  add column paid_at timestamptz,
  add column cancelled_at timestamptz,
  add column cancel_reason text check (cancel_reason in ('unpaid_transfer', 'shopper', 'store', 'out_of_stock')),
  add column tax_inclusive boolean,
  add column subtotal_amount bigint check (subtotal_amount >= 0),
  add column discount_amount bigint not null default 0 check (discount_amount >= 0),
  add column shipping_amount bigint check (shipping_amount >= 0),
  add column tax_amount bigint check (tax_amount >= 0),
  add column duties_amount bigint not null default 0 check (duties_amount >= 0),
  add column total_amount bigint check (total_amount >= 0),
  add column refunded_amount bigint not null default 0 check (refunded_amount >= 0),
  add column shipping_method_label text check (char_length(shipping_method_label) <= 120),
  add column payment_method text check (payment_method in ('stripe', 'paypal', 'razorpay', 'cashfree', 'phonepe', 'cod', 'bank_transfer')),
  -- A bank transfer unpaid by then is cancelled by the system and its stock released (decided 2026-10-05 on #284).
  add column payment_due_by timestamptz,
  -- Whether the order holds its lines' stock (reserved at payment, or at placement for cash on delivery and transfer).
  add column stock_reserved boolean not null default false,
  add constraint order_placed check (state = 'cart' or (number is not null and placed_at is not null and total_amount is not null));
create unique index order_number_key on "order" (store_id, number) where number is not null;
create index order_unpaid_transfer_idx on "order" (payment_due_by) where state = 'placed' and payment_state = 'pending' and payment_due_by is not null;

-- The snapshot (DATA-MODEL §7.1): what was sold, as it was sold; the catalogue may change afterwards.
create table order_line (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  store_id uuid not null,
  seller_id uuid,
  version_id uuid not null,
  product_id uuid not null,
  name text not null check (char_length(name) between 1 and 255),
  version_name text check (char_length(version_name) <= 255),
  sku text check (char_length(sku) <= 64),
  hs_code text,
  tax_class_id uuid,
  tax_rate_bps integer check (tax_rate_bps between 0 and 10000),
  quantity integer not null check (quantity between 1 and 999),
  unit_amount bigint not null check (unit_amount >= 0),
  discount_amount bigint not null default 0 check (discount_amount >= 0),
  tax_amount bigint not null default 0 check (tax_amount >= 0),
  line_total_amount bigint not null check (line_total_amount >= 0),
  weight_grams integer,
  -- Where this line's stock is held while it is reserved, so a cancellation releases exactly that (one location a line).
  reserved_warehouse_id uuid,
  fulfilled_quantity integer not null default 0 check (fulfilled_quantity >= 0),
  returned_quantity integer not null default 0 check (returned_quantity >= 0),
  refunded_quantity integer not null default 0 check (refunded_quantity >= 0),
  position integer not null default 0,
  foreign key (order_id, store_id) references "order" (id, store_id),
  foreign key (seller_id, store_id) references seller (id, store_id)
);
create index order_line_order_idx on order_line (order_id, position);
create index order_line_seller_idx on order_line (store_id, seller_id) where seller_id is not null;

create table order_adjustment (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  order_line_id uuid references order_line (id),
  store_id uuid not null,
  kind text not null check (kind in ('discount', 'shipping', 'tax', 'duties', 'rounding')),
  label text not null check (char_length(label) between 1 and 120),
  amount bigint not null,
  tax_rate_bps integer,
  foreign key (order_id, store_id) references "order" (id, store_id)
);
create index order_adjustment_order_idx on order_adjustment (order_id);

-- One part per owner (the merchant's own is a null seller), its shipping mode the supplier's at placement (ACCESS §7.3).
create table order_part (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  store_id uuid not null,
  seller_id uuid,
  shipping_mode text not null check (shipping_mode in ('store', 'to-store', 'to-shopper')),
  state text not null default 'to_ship' check (state in ('to_ship', 'sent_to_store', 'partly_shipped', 'shipped', 'delivered', 'cancelled')),
  foreign key (order_id, store_id) references "order" (id, store_id),
  foreign key (seller_id, store_id) references seller (id, store_id)
);
create unique index order_part_owner_key on order_part (order_id, seller_id) nulls not distinct;

-- The merchant's own providers (Settings › Payment setup; THIRD-PARTY-ACCESS §3.1); never the plan's card (§7.9).
create table payment_provider_account (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  provider text not null check (provider in ('stripe', 'paypal', 'razorpay', 'cashfree', 'phonepe', 'cod', 'bank_transfer')),
  mode text not null default 'live' check (mode in ('test', 'live')),
  -- Sealed with CREDENTIALS_KEK (auth/secretBox.ts), never returned once saved; Stripe Connect holds none.
  credentials_enc text,
  webhook_secret_enc text,
  -- What a storefront may hold: a publishable key or client id, a connected account's id.
  public_key text check (char_length(public_key) <= 255),
  external_account_id text check (char_length(external_account_id) <= 255),
  bank_details text check (char_length(bank_details) <= 1000),
  status text not null default 'live' check (status in ('live', 'off')),
  paused_by_plan boolean not null default false,
  position integer not null default 0,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index payment_provider_account_key on payment_provider_account (store_id, provider);
create index payment_provider_account_external_idx on payment_provider_account (provider, external_account_id) where external_account_id is not null;

create table payment (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  store_id uuid not null,
  provider text not null check (provider in ('stripe', 'paypal', 'razorpay', 'cashfree', 'phonepe', 'cod', 'bank_transfer')),
  provider_account_id uuid references payment_provider_account (id),
  -- The provider's own id for this payment: webhooks are idempotent through it.
  provider_ref text check (char_length(provider_ref) <= 255),
  kind text not null check (kind in ('card', 'wallet', 'upi', 'cod', 'bank_transfer', 'other')),
  state text not null default 'pending' check (state in ('pending', 'authorised', 'captured', 'failed', 'refunded')),
  amount bigint not null check (amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  mode text not null default 'live' check (mode in ('test', 'live')),
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (order_id, store_id) references "order" (id, store_id)
);
create unique index payment_provider_ref_key on payment (provider, provider_ref) where provider_ref is not null;
create index payment_order_idx on payment (order_id);

-- Placement and payment are the engine's, in system scope; the merchant reads its orders and sets up its providers, a
-- shopper reads its own order's snapshot. Suppliers reach orders with SAPI 11, through their own views (§7.11).
grant select, insert, update, delete on order_line, order_adjustment, order_part, payment_provider_account, payment to app_system;
grant select (number, placed_at, paid_at, cancelled_at, cancel_reason, tax_inclusive, subtotal_amount, discount_amount, shipping_amount, tax_amount,
  duties_amount, total_amount, refunded_amount, shipping_method_label, payment_method, payment_due_by, stock_reserved) on "order" to app_request, app_shop;
grant select on order_line, order_adjustment, order_part, payment to app_request;
grant select (id, store_id, provider, mode, public_key, external_account_id, bank_details, status, paused_by_plan, position, connected_at, updated_at)
  on payment_provider_account to app_request;
grant insert (store_id, provider, mode, bank_details, status, position) on payment_provider_account to app_request;
grant update (bank_details, status, position, updated_at) on payment_provider_account to app_request;
grant delete on payment_provider_account to app_request;
grant select (id, order_id, store_id, version_id, product_id, name, version_name, sku, quantity, unit_amount, discount_amount, tax_amount,
  line_total_amount, position) on order_line to app_shop;
grant select (id, order_id, store_id, kind, label, amount) on order_adjustment to app_shop;
grant select (id, order_id, store_id, provider, kind, state, amount, currency) on payment to app_shop;
-- What checkout shows for each way to pay: never a credential, a bank's details only for a transfer.
grant select (id, store_id, provider, mode, public_key, bank_details, status, paused_by_plan, position) on payment_provider_account to app_shop;

do $$
declare
  t text;
begin
  foreach t in array array['order_line', 'order_adjustment', 'order_part', 'payment_provider_account', 'payment'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %I on %I for all to app_system using (true) with check (true)', t || '_system', t);
    execute format('create policy %I on %I for select to app_request
      using (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'') and app_setting_text(''app.seller_id'') = '''')', t || '_merchant', t);
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

-- A shopper's own order's lines, adjustments and payment, through the order's own policy (§7.11).
do $$
declare
  t text;
begin
  foreach t in array array['order_line', 'order_adjustment', 'payment'] loop
    execute format('create policy %I on %I for select to app_shop
      using (app_setting_text(''app.scope'') = ''shop'' and store_id = app_setting_uuid(''app.store_id'') and exists (select 1 from "order" o where o.id = order_id))', t || '_shop', t);
  end loop;
end
$$;
create policy payment_provider_account_shop on payment_provider_account for select to app_shop
using (app_setting_text('app.scope') = 'shop' and store_id = app_setting_uuid('app.store_id') and status = 'live' and not paused_by_plan);
-- Settings › Payment setup writes the store's own manual methods; providers with credentials connect in system scope.
create policy payment_provider_account_merchant_write on payment_provider_account for all to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = ''
  and app_setting_text('app.support') <> 'read' and provider in ('cod', 'bank_transfer'))
with check (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = ''
  and app_setting_text('app.support') <> 'read' and provider in ('cod', 'bank_transfer'));
