-- SAPI 16 (#301): Connect Shopify (CATALOG K7; DATA-MODEL §7.10 external_connection). One connection an owner
-- (the store, or a supplier its own); its token sealed with the credential key, never shown. A pending row holds
-- the hash of the state Shopify sends back; the callback on the hooks host makes it `approved` with the hash of a
-- one-time key, and only the person who started it, back in their own session, makes it `connected`.

create table external_connection (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  seller_id uuid references seller (id),
  provider text not null check (provider in ('shopify')),
  shop_domain text not null check (shop_domain ~ '^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$'),
  status text not null check (status in ('pending', 'approved', 'connected', 'expired')),
  token_sealed text,
  state_hash text check (state_hash ~ '^[0-9a-f]{64}$'),
  finish_hash text check (finish_hash ~ '^[0-9a-f]{64}$'),
  return_host text,
  connected_by uuid not null,
  created_at timestamptz(3) not null default now(),
  connected_at timestamptz(3),
  expires_at timestamptz(3),
  constraint external_connection_token check ((status in ('approved', 'connected')) = (token_sealed is not null))
);

create unique index external_connection_owner_key on external_connection (store_id, seller_id, provider) nulls not distinct;
create unique index external_connection_state_key on external_connection (state_hash) where state_hash is not null;

grant select, insert, delete on external_connection to app_request, app_supplier;
grant update (shop_domain, status, token_sealed, state_hash, finish_hash, return_host, connected_by, connected_at, expires_at) on external_connection to app_request, app_supplier;
grant select, update, delete on external_connection to app_system;

alter table external_connection enable row level security;
alter table external_connection force row level security;
create policy external_connection_system on external_connection for all to app_system using (true) with check (true);
-- The merchant side reaches the store's own connection; a supplier its own only.
create policy external_connection_store on external_connection for all to app_request, app_supplier
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id')
  and seller_id is not distinct from nullif(app_setting_text('app.seller_id'), '')::uuid)
with check (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id')
  and seller_id is not distinct from nullif(app_setting_text('app.seller_id'), '')::uuid);
create policy request_scope on external_connection as restrictive for all to app_request, app_supplier
using (app_setting_text('app.scope') in ('store', 'shop', 'partner', 'platform'))
with check (app_setting_text('app.scope') in ('store', 'shop', 'partner', 'platform'));
create policy partner_scope on external_connection as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on external_connection as restrictive for all to app_platform using (false) with check (false);
create policy system_scope on external_connection as restrictive for all to app_system
using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
create policy support_no_insert on external_connection as restrictive for insert to app_request, app_supplier with check (app_setting_text('app.support') <> 'read');
create policy support_no_update on external_connection as restrictive for update to app_request, app_supplier with check (app_setting_text('app.support') <> 'read');
create policy support_no_delete on external_connection as restrictive for delete to app_request, app_supplier using (app_setting_text('app.support') <> 'read');

-- A connected import: the products picked (null for all), read from the shop a page at a time into the file.
alter table catalog_import add column connection_id uuid references external_connection (id) on delete set null;
alter table catalog_import add column selection jsonb;
alter table catalog_import add column cursor text;
grant update (file, cursor) on catalog_import to app_request, app_supplier;
