-- AI gateway (#950; DATA-MODEL §7 store_ai_account): a store's own AI account, one sealed key, for plans without AI included and
-- for the switch below. The merchant reads its metadata only; the key is written and opened in system scope, never by a request role.
create table store_ai_account (
  store_id uuid primary key references store (id),
  provider text not null check (provider in ('anthropic', 'openai')),
  key_enc text not null,
  key_prefix text not null,
  status text not null default 'untested' check (status in ('untested', 'ok', 'rejected')),
  last_tested_at timestamptz,
  -- Off unless the Owner turns it on: the store's own account then covers runs once the plan's are used up (never silent).
  use_when_plan_used boolean not null default false,
  connected_by text not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select (store_id, provider, key_prefix, status, last_tested_at, use_when_plan_used, connected_by, connected_at, updated_at) on store_ai_account to app_request;
grant select, insert, update, delete on store_ai_account to app_system;

alter table store_ai_account enable row level security;
alter table store_ai_account force row level security;
create policy request_scope on store_ai_account as restrictive for all to app_request
  using (app_setting_text('app.scope') = 'store') with check (app_setting_text('app.scope') = 'store');
create policy partner_scope on store_ai_account as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on store_ai_account as restrictive for all to app_platform using (false) with check (false);
create policy system_scope on store_ai_account as restrictive for all to app_system
  using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
create policy store_ai_account_system on store_ai_account for all to app_system using (true) with check (true);
create policy store_ai_account_merchant on store_ai_account for select to app_request
  using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '');

-- A gateway run is one more kind of model call, made by a store's key (kind 'gateway'); its prompt is never kept.
alter table ai_run drop constraint ai_run_kind_check;
alter table ai_run add constraint ai_run_kind_check check (kind in ('design', 'repair', 'migration', 'description', 'translation', 'gateway'));
alter table ai_run add column api_key_id uuid references api_key (id);
alter table ai_run add column provider text check (provider in ('anthropic', 'openai'));
