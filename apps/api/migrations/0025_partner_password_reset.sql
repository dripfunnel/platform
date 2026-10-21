-- Partner password reset (#208): how a request becomes rows and a token is in ACCESS.md §4 and
-- §6.1 and DATA-MODEL.md §3.2.

create table partner_password_reset (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  partner_id uuid not null references partner (id),
  partner_user_id uuid not null references partner_user (id),
  token_hash text unique,
  expires_at timestamptz(3),
  used_at timestamptz(3),
  created_at timestamptz(3) not null default now(),
  unique (request_id, partner_user_id)
);

create index partner_password_reset_user_idx on partner_password_reset (partner_user_id, created_at desc);

-- Sign-in's work: app_system alone, as for partner_session.
grant select, insert, update on partner_password_reset to app_system;

alter table partner_password_reset enable row level security;
alter table partner_password_reset force row level security;
create policy request_scope on partner_password_reset as restrictive for all to app_request
  using (app_setting_text('app.scope') in ('store', 'shop')) with check (app_setting_text('app.scope') in ('store', 'shop'));
create policy partner_scope on partner_password_reset as restrictive for all to app_partner
  using (app_setting_text('app.scope') = 'partner') with check (app_setting_text('app.scope') = 'partner');
create policy platform_scope on partner_password_reset as restrictive for all to app_platform
  using (app_setting_text('app.scope') = 'platform') with check (app_setting_text('app.scope') = 'platform');
create policy system_scope on partner_password_reset as restrictive for all to app_system
  using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
create policy partner_password_reset_system on partner_password_reset for all to app_system using (true) with check (true);
