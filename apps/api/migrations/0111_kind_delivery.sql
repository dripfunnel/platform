-- SAPI 22 (#323), part 2: each kind delivered once paid (CATALOG-DESIGN T14; FIRST-RELEASE §19 "digital downloads after
-- payment"): a download's link, a key from the pool, a gift card issued and emailed on the day the shopper chose.

-- Who a gift card goes to and when (DF Storefront Prototype's gift card page), chosen in the cart and kept on the order.
do $$
declare
  t text;
begin
  foreach t in array array['cart_line', 'order_line'] loop
    execute format('alter table %I
      add column gift_recipient_name text check (char_length(gift_recipient_name) between 1 and 120),
      add column gift_recipient_email text check (char_length(gift_recipient_email) between 3 and 254),
      add column gift_message text check (char_length(gift_message) <= 200),
      add column gift_send_on date,
      add constraint %I check ((gift_recipient_email is null) = (gift_recipient_name is null))', t, t || '_gift_recipient');
  end loop;
end
$$;
-- The shopper's own order shows who each card goes to and when; a supplier's column grant never reaches them.
grant select (gift_recipient_name, gift_recipient_email, gift_message, gift_send_on) on order_line to app_shop;

-- A paid order's download: how many times its link still works and until when. The link is signed, never stored
-- (auth/signedLink.ts), and serves the file from R2 through the Worker, never from a public address.
create table order_download (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  order_line_id uuid not null unique references order_line (id),
  store_id uuid not null,
  asset_id uuid not null,
  uses_left integer not null check (uses_left >= 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (order_id, store_id) references "order" (id, store_id),
  foreign key (asset_id, store_id) references asset (id, store_id)
);
create index order_download_order_idx on order_download (store_id, order_id);

-- A gift card, the store's liability: inside the store, written by the engine in system scope only. Its code exists
-- only in the email that sends it; the row keeps its hash and last four characters (ACCESS §6.1's token rule).
create table gift_card (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  code_hash text check (code_hash ~ '^[0-9a-f]{64}$'),
  code_last4 text check (code_last4 ~ '^[A-Z0-9]{4}$'),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  initial_amount bigint not null check (initial_amount > 0),
  balance_amount bigint not null check (balance_amount >= 0 and balance_amount <= initial_amount),
  -- Null never expires; counted from the day it is sent (decided on #337).
  expiry_months integer check (expiry_months between 12 and 120),
  expires_at timestamptz,
  recipient_name text check (char_length(recipient_name) between 1 and 120),
  recipient_email text not null check (char_length(recipient_email) between 3 and 254),
  message text check (char_length(message) <= 200),
  send_on date,
  sent_at timestamptz,
  order_line_id uuid unique references order_line (id),
  issued_by uuid,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((code_hash is null) = (code_last4 is null)),
  check ((code_hash is null) = (sent_at is null)),
  check ((order_line_id is null) <> (issued_by is null))
);
create unique index gift_card_code_key on gift_card (store_id, code_hash) where code_hash is not null;
create index gift_card_store_idx on gift_card (store_id, created_at desc);

-- Every change to a card's balance, once each for an order (the ledger PLATFORM-PROMPT §5.4 Money asks of balances).
create table gift_card_movement (
  id uuid primary key default gen_random_uuid(),
  gift_card_id uuid not null references gift_card (id),
  store_id uuid not null,
  kind text not null check (kind in ('issued', 'redeemed', 'restored')),
  amount bigint not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  order_id uuid,
  created_at timestamptz not null default now(),
  foreign key (order_id, store_id) references "order" (id, store_id)
);
create unique index gift_card_movement_once_key on gift_card_movement (gift_card_id, kind, order_id) where order_id is not null;
create index gift_card_movement_card_idx on gift_card_movement (store_id, gift_card_id, created_at);

grant select, insert, update on order_download, gift_card, gift_card_movement to app_system;
grant select on order_download to app_request;
grant select (id, order_id, order_line_id, store_id, uses_left, expires_at) on order_download to app_shop;
-- The buyer reads the keys its own order took, and nothing of the pool (0110).
grant select (id, store_id, key, order_line_id) on licence_key to app_shop;

do $$
declare
  t text;
begin
  foreach t in array array['order_download', 'gift_card', 'gift_card_movement'] loop
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

create policy order_download_merchant on order_download for select to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '');
-- Through the order's own policy (§7.11), as its lines are.
create policy order_download_shop on order_download for select to app_shop
using (app_setting_text('app.scope') = 'shop' and store_id = app_setting_uuid('app.store_id') and exists (select 1 from "order" o where o.id = order_id));
create policy licence_key_shop on licence_key for select to app_shop
using (app_setting_text('app.scope') = 'shop' and store_id = app_setting_uuid('app.store_id') and order_line_id is not null
  and exists (select 1 from order_line l where l.id = order_line_id));
alter policy request_scope on licence_key to app_request, app_shop
using (app_setting_text('app.scope') in ('store', 'shop', 'partner', 'platform') and (current_user <> 'app_shop' or app_setting_text('app.scope') = 'shop'))
with check (app_setting_text('app.scope') in ('store', 'shop', 'partner', 'platform') and (current_user <> 'app_shop' or app_setting_text('app.scope') = 'shop'));
