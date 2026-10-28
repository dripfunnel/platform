-- ENV 6 (#275): a partner's own third-party credentials, AI provider keys first (THIRD-PARTY-ACCESS §4, §8.3).
-- One row per named profile; a partner holds many `ai` rows and one default. key_enc is sealed under CREDENTIALS_KEK and is
-- granted to app_system only, so no console role, staff included, can read a key back (DATA-MODEL §5.3).
create table partner_credential (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partner (id),
  kind text not null check (kind in ('ai')),
  provider text not null check (provider in ('anthropic', 'openai')),
  name text not null check (length(name) between 1 and 60),
  is_default boolean not null default false,
  key_enc text not null,
  key_prefix text not null,
  status text not null default 'untested' check (status in ('untested', 'ok', 'rejected')),
  last_tested_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index partner_credential_name_key on partner_credential (partner_id, kind, lower(name));
create unique index partner_credential_default_key on partner_credential (partner_id, kind) where is_default;

grant select (id, partner_id, kind, provider, name, is_default, key_prefix, status, last_tested_at, created_by, created_at, updated_at) on partner_credential to app_partner, app_platform;
grant insert on partner_credential to app_partner;
grant update (name, is_default, status, last_tested_at, updated_at) on partner_credential to app_partner;
grant delete on partner_credential to app_partner;
grant select, update on partner_credential to app_system;

alter table partner_credential enable row level security;
alter table partner_credential force row level security;
create policy request_scope on partner_credential as restrictive for all to app_request
  using (app_setting_text('app.scope') in ('store', 'shop')) with check (app_setting_text('app.scope') in ('store', 'shop'));
create policy partner_scope on partner_credential as restrictive for all to app_partner
  using (app_setting_text('app.scope') = 'partner') with check (app_setting_text('app.scope') = 'partner');
create policy platform_scope on partner_credential as restrictive for all to app_platform
  using (app_setting_text('app.scope') = 'platform') with check (app_setting_text('app.scope') = 'platform');
create policy system_scope on partner_credential as restrictive for all to app_system
  using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
create policy partner_credential_partner on partner_credential for all to app_partner
  using (partner_id = app_setting_uuid('app.partner_id')) with check (partner_id = app_setting_uuid('app.partner_id'));
create policy partner_credential_staff_read on partner_credential for select to app_platform using (true);
create policy partner_credential_system on partner_credential for all to app_system using (true) with check (true);
