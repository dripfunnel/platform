-- Merchant password reset (#290): as partner_password_reset (0025), for a person on a portal
-- host; ACCESS.md §4 and DATA-MODEL.md §3.3 own the rules.

create table user_password_reset (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  partner_id uuid not null references partner (id),
  user_id uuid not null references "user" (id),
  token_hash text unique,
  expires_at timestamptz(3),
  used_at timestamptz(3),
  created_at timestamptz(3) not null default now(),
  unique (request_id, user_id)
);

create index user_password_reset_user_idx on user_password_reset (user_id, created_at desc);

-- Sign-in's work: app_system alone, as for user_session.
grant select, insert, update on user_password_reset to app_system;

alter table user_password_reset enable row level security;
alter table user_password_reset force row level security;
create policy request_scope on user_password_reset as restrictive for all to app_request
  using (app_setting_text('app.scope') in ('store', 'shop')) with check (app_setting_text('app.scope') in ('store', 'shop'));
create policy partner_scope on user_password_reset as restrictive for all to app_partner
  using (app_setting_text('app.scope') = 'partner') with check (app_setting_text('app.scope') = 'partner');
create policy platform_scope on user_password_reset as restrictive for all to app_platform
  using (app_setting_text('app.scope') = 'platform') with check (app_setting_text('app.scope') = 'platform');
create policy system_scope on user_password_reset as restrictive for all to app_system
  using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
create policy user_password_reset_system on user_password_reset for all to app_system using (true) with check (true);
