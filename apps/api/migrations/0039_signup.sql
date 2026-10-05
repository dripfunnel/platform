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
  store_id uuid references store (id),
  expires_at timestamptz(3) not null,
  created_at timestamptz(3) not null default now()
);

create index signup_partner_email_idx on signup (partner_id, lower(email));
create index signup_expires_idx on signup (expires_at);

-- Every sign-up text, kept a day after its sign-up is gone: the limits per sign-up, per number and per
-- partner read it, so no one can pump texts to numbers they don't own (#290's review).
create table signup_text (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partner (id),
  signup_id uuid references signup (id) on delete set null,
  phone text not null,
  sent_at timestamptz(3) not null
);

create index signup_text_phone_idx on signup_text (partner_id, phone, sent_at desc);
create index signup_text_partner_idx on signup_text (partner_id, sent_at desc);
create index signup_text_signup_idx on signup_text (signup_id, sent_at desc);

-- Sign-up's work: app_system alone, before there is any caller.
grant select, insert, update, delete on signup, signup_text to app_system;

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

alter table signup_text enable row level security;
alter table signup_text force row level security;
create policy request_scope on signup_text as restrictive for all to app_request
  using (app_setting_text('app.scope') in ('store', 'shop')) with check (app_setting_text('app.scope') in ('store', 'shop'));
create policy partner_scope on signup_text as restrictive for all to app_partner
  using (app_setting_text('app.scope') = 'partner') with check (app_setting_text('app.scope') = 'partner');
create policy platform_scope on signup_text as restrictive for all to app_platform
  using (app_setting_text('app.scope') = 'platform') with check (app_setting_text('app.scope') = 'platform');
create policy system_scope on signup_text as restrictive for all to app_system
  using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
create policy signup_text_system on signup_text for all to app_system using (true) with check (true);
