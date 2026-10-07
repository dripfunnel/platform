-- Card payments on the merchant's own accounts (SAPI 10 part 2; THIRD-PARTY-ACCESS §3.1; DATA-MODEL §7.6): Stripe
-- connected by OAuth, test mode on preview storefronts, and a card order left unpaid let go after a day.

-- A store's test keys for its preview storefront sit beside its live ones (part 3); Stripe's one connection serves both.
drop index payment_provider_account_key;
create unique index payment_provider_account_key on payment_provider_account (store_id, provider, mode);

-- `unpaid`: a card payment never completed within a day; a transfer keeps its own reason (LOGGING §3).
alter table "order" drop constraint order_cancel_reason_check;
alter table "order" add constraint order_cancel_reason_check check (cancel_reason in ('unpaid_transfer', 'unpaid', 'shopper', 'store', 'out_of_stock'));

-- Connect Stripe, between the merchant leaving for Stripe and finishing in their own session (as external_connection
-- does for Shopify): only the hashes of the state and the one-time key are kept, and the row goes once finished.
create table payment_connect (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  provider text not null check (provider in ('stripe')),
  status text not null check (status in ('pending', 'approved')),
  state_hash text check (state_hash ~ '^[0-9a-f]{64}$'),
  finish_hash text check (finish_hash ~ '^[0-9a-f]{64}$'),
  return_host text not null check (char_length(return_host) <= 255),
  started_by uuid not null,
  external_account_id text check (external_account_id ~ '^acct_[A-Za-z0-9]{1,100}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint payment_connect_account check ((status = 'approved') = (external_account_id is not null))
);
create unique index payment_connect_store_key on payment_connect (store_id, provider);
create unique index payment_connect_state_key on payment_connect (state_hash) where state_hash is not null;

-- Started and finished by the engine for the store the caller acts in, and answered on the hooks host, all in system scope.
grant select, insert, update, delete on payment_connect to app_system;
alter table payment_connect enable row level security;
alter table payment_connect force row level security;
create policy payment_connect_system on payment_connect for all to app_system using (true) with check (true);
create policy system_scope on payment_connect as restrictive for all to app_system
  using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
create policy request_scope on payment_connect as restrictive for all to app_request, app_shop using (false) with check (false);
create policy partner_scope on payment_connect as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on payment_connect as restrictive for all to app_platform using (false) with check (false);
