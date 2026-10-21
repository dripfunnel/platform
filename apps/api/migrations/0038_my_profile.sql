-- My profile (#290): the person's look and password date, and an email change confirmed from the
-- new address. ACCESS.md §4 and DATA-MODEL.md §3.3 own the rules.

alter table "user"
  add column theme text check (theme in ('light', 'dark')),
  add column password_changed_at timestamptz(3);

grant select (theme, password_changed_at), update (theme) on "user" to app_request;

create table user_email_change (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partner (id),
  user_id uuid not null references "user" (id),
  new_email text not null,
  token_hash text unique,
  expires_at timestamptz(3) not null,
  used_at timestamptz(3),
  created_at timestamptz(3) not null default now()
);

create index user_email_change_user_idx on user_email_change (user_id, created_at desc);

-- Sign-in's work: app_system alone, as for user_password_reset.
grant select, insert, update on user_email_change to app_system;

alter table user_email_change enable row level security;
alter table user_email_change force row level security;
create policy request_scope on user_email_change as restrictive for all to app_request
  using (app_setting_text('app.scope') in ('store', 'shop')) with check (app_setting_text('app.scope') in ('store', 'shop'));
create policy partner_scope on user_email_change as restrictive for all to app_partner
  using (app_setting_text('app.scope') = 'partner') with check (app_setting_text('app.scope') = 'partner');
create policy platform_scope on user_email_change as restrictive for all to app_platform
  using (app_setting_text('app.scope') = 'platform') with check (app_setting_text('app.scope') = 'platform');
create policy system_scope on user_email_change as restrictive for all to app_system
  using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
create policy user_email_change_system on user_email_change for all to app_system using (true) with check (true);
