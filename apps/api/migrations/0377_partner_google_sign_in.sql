-- A partner's own Google client for "Continue with Google" on its portal host (#1046; THIRD-PARTY-ACCESS §2.9).
-- One per partner; the secret is sealed (auth/secretBox) and read back only in system scope, by the sign-in.
create table partner_google_sign_in (
  partner_id uuid primary key references partner (id),
  client_id text not null check (client_id ~ '^[0-9A-Za-z-]+\.apps\.googleusercontent\.com$'),
  secret_enc text not null,
  secret_hint text not null,
  enabled boolean not null default true,
  set_by text not null,
  set_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select (partner_id, client_id, secret_hint, enabled, set_by, set_at, updated_at) on partner_google_sign_in to app_partner, app_platform;
grant insert on partner_google_sign_in to app_partner;
grant update (client_id, secret_enc, secret_hint, enabled, set_by, set_at, updated_at) on partner_google_sign_in to app_partner;
grant select on partner_google_sign_in to app_system;

alter table partner_google_sign_in enable row level security;
alter table partner_google_sign_in force row level security;

create policy request_scope on partner_google_sign_in as restrictive for all to app_request
  using (app_setting_text('app.scope') in ('store', 'shop')) with check (app_setting_text('app.scope') in ('store', 'shop'));
create policy partner_scope on partner_google_sign_in as restrictive for all to app_partner
  using (app_setting_text('app.scope') = 'partner') with check (app_setting_text('app.scope') = 'partner');
create policy platform_scope on partner_google_sign_in as restrictive for all to app_platform
  using (app_setting_text('app.scope') = 'platform') with check (app_setting_text('app.scope') = 'platform');
create policy system_scope on partner_google_sign_in as restrictive for all to app_system
  using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
create policy partner_google_sign_in_partner on partner_google_sign_in for all to app_partner
  using (partner_id = app_setting_uuid('app.partner_id')) with check (partner_id = app_setting_uuid('app.partner_id'));
create policy partner_google_sign_in_staff_read on partner_google_sign_in for select to app_platform using (true);
create policy partner_google_sign_in_system on partner_google_sign_in for select to app_system using (true);

-- A sign-up started with Google has its address proven and no password (ACCESS.md §2); the account it makes has none either.
alter table signup alter column password_hash drop not null;
