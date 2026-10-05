-- Merchant sign-up (#290): answers kept between steps until the store exists (SAAS.md §4.1).
-- ACCESS.md §4 and DATA-MODEL.md §3.3 own the rules; the password is kept as its hash.

create table signup (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partner (id),
  token_hash text not null unique,
  stage text not null check (stage in ('email', 'store', 'phone', 'provisioning')),
  name text not null,
  email text not null,
  password_hash text not null,
  email_code_hash text,
  email_code_expires_at timestamptz(3),
  email_code_attempts integer not null default 0 check (email_code_attempts >= 0),
  store_name text,
  subdomain text,
  country text,
  phone text,
  phone_code_hash text,
  phone_code_expires_at timestamptz(3),
  phone_code_attempts integer not null default 0 check (phone_code_attempts >= 0),
  phone_codes_sent timestamptz(3)[] not null default '{}',
  store_id uuid references store (id),
  expires_at timestamptz(3) not null,
  created_at timestamptz(3) not null default now()
);

create index signup_partner_email_idx on signup (partner_id, lower(email));
create index signup_expires_idx on signup (expires_at);

-- Sign-up's work: app_system alone, before there is any caller.
grant select, insert, update, delete on signup to app_system;

alter table signup enable row level security;
alter table signup force row level security;
create policy request_scope on signup as restrictive for all to app_request
  using (app_setting_text('app.scope') in ('store', 'shop')) with check (app_setting_text('app.scope') in ('store', 'shop'));
create policy partner_scope on signup as restrictive for all to app_partner
  using (app_setting_text('app.scope') = 'partner') with check (app_setting_text('app.scope') = 'partner');
create policy platform_scope on signup as restrictive for all to app_platform
  using (app_setting_text('app.scope') = 'platform') with check (app_setting_text('app.scope') = 'platform');
create policy system_scope on signup as restrictive for all to app_system
  using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
create policy signup_system on signup for all to app_system using (true) with check (true);
