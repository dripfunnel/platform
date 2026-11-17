-- DripFunnel's own SMS and WhatsApp accounts, set in the admin console, and the per-partner switches that let a partner
-- use them (#1543; THIRD-PARTY-ACCESS §4, §8.3; DATA-MODEL platform_credential). Additive: the previous release reads none
-- of the new tables or columns, and never writes `dripfunnel` to a route.

-- One row per provider, as a partner's (0399): the secret sealed with CREDENTIALS_KEK in key_enc, the rest in `settings`.
-- Every column, the secret's hint included, is app_system's alone: staff read them through the Admin API's system scope.
create table platform_credential (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  provider text not null,
  key_enc text not null,
  key_prefix text not null,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  status text not null default 'untested' check (status in ('untested', 'ok', 'rejected')),
  last_tested_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_credential_kind_provider check ((kind, provider) in (('sms', 'msg91'), ('sms', 'twilio'), ('sms', 'sns'), ('whatsapp', 'meta')))
);
create unique index platform_credential_account_key on platform_credential (kind, provider);

grant select, insert, update, delete on platform_credential to app_system;
alter table platform_credential enable row level security;
alter table platform_credential force row level security;
create policy system_scope on platform_credential as restrictive for all to app_system
  using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
create policy platform_credential_system on platform_credential for all to app_system using (true) with check (true);

-- DripFunnel's provider per SMS route (null: the route's first provider it holds, as a partner's) and its WhatsApp switch.
create table platform_messaging (
  id boolean primary key default true check (id),
  sms_route_india text check (sms_route_india in ('msg91', 'sns')),
  sms_route_rest text check (sms_route_rest in ('twilio', 'sns')),
  whatsapp_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into platform_messaging default values;

grant select, update on platform_messaging to app_system;
alter table platform_messaging enable row level security;
alter table platform_messaging force row level security;
create policy system_scope on platform_messaging as restrictive for all to app_system
  using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
create policy platform_messaging_system on platform_messaging for all to app_system using (true) with check (true);

-- Admin's per-partner switches, off for every partner until staff turn them on; staff write them (app_platform holds
-- `update` on partner, 0010), the partner only reads them.
alter table partner add column df_sms_enabled boolean not null default false;
alter table partner add column df_whatsapp_enabled boolean not null default false;

-- The partner's choice: `dripfunnel` as a route's provider, and whose WhatsApp account sends (null: its own if it has one).
alter table partner drop constraint partner_sms_route_india_check;
alter table partner add constraint partner_sms_route_india_check check (sms_route_india in ('msg91', 'sns', 'dripfunnel'));
alter table partner drop constraint partner_sms_route_rest_check;
alter table partner add constraint partner_sms_route_rest_check check (sms_route_rest in ('twilio', 'sns', 'dripfunnel'));
alter table partner add column whatsapp_account text check (whatsapp_account in ('own', 'dripfunnel'));
grant update (whatsapp_account) on partner to app_partner;
