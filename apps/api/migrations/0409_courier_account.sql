-- #1489: a store's own courier login (Shiprocket's API user), in place of the partner's account (THIRD-PARTY-ACCESS §3.2,
-- §4; DATA-MODEL §7.2). The password and the tracking hook's token are sealed with the credential key as one value and never
-- selected for display; the email is shown. Deleting the row is "Disconnect". Backward-compatible: nothing reads it yet.

create table courier_account (
  store_id uuid not null references store (id),
  provider text not null check (provider in ('shiprocket')),
  email text not null check (char_length(email) between 3 and 254),
  credentials_sealed text not null,
  connected_by uuid not null,
  connected_at timestamptz(3) not null default now(),
  primary key (store_id, provider)
);

-- The merchant side writes its own store's row only; a supplier has no access at all. The checkout, label and hook paths
-- read it in system scope.
grant select (store_id, provider, email, connected_by, connected_at) on courier_account to app_request;
grant insert, delete on courier_account to app_request;
grant select on courier_account to app_system;

alter table courier_account enable row level security;
alter table courier_account force row level security;
create policy courier_account_system on courier_account for select to app_system using (true);
create policy courier_account_store on courier_account for all to app_request
using (app_setting_text('app.scope') = 'store' and app_setting_text('app.seller_id') = '' and store_id = app_setting_uuid('app.store_id'))
with check (app_setting_text('app.scope') = 'store' and app_setting_text('app.seller_id') = '' and store_id = app_setting_uuid('app.store_id'));
create policy request_scope on courier_account as restrictive for all to app_request
using (app_setting_text('app.scope') in ('store', 'shop', 'partner', 'platform'))
with check (app_setting_text('app.scope') in ('store', 'shop', 'partner', 'platform'));
create policy partner_scope on courier_account as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on courier_account as restrictive for all to app_platform using (false) with check (false);
create policy system_scope on courier_account as restrictive for all to app_system
using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
create policy support_no_insert on courier_account as restrictive for insert to app_request with check (app_setting_text('app.support') <> 'read');
create policy support_no_update on courier_account as restrictive for update to app_request with check (app_setting_text('app.support') <> 'read');
create policy support_no_delete on courier_account as restrictive for delete to app_request using (app_setting_text('app.support') <> 'read');
