-- Merchant and supplier people's sessions on a partner's portal host (ACCESS.md §4,
-- DATA-MODEL.md §3.3; #288). The Store API reads them; sign-in (SAPI 2) writes them.
-- The hash is a credential: app_system alone reads it.
create table user_session (
  id_hash text primary key,
  user_id uuid not null references "user" (id),
  partner_id uuid not null references partner (id),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  absolute_expires_at timestamptz not null,
  -- "Remember me" lengthens both bounds, never removes them (ACCESS.md §4, #337).
  remember boolean not null default false,
  device_label text,
  user_agent text
);

create index user_session_user_id_idx on user_session (user_id);

grant select, insert, update, delete on user_session to app_system;
-- "Where you're signed in" lists a person's own sessions, never the hash (DATA-MODEL.md §3.3).
grant select (user_id, partner_id, created_at, last_seen_at, absolute_expires_at, remember, device_label, user_agent) on user_session to app_request;

alter table user_session enable row level security;
alter table user_session force row level security;

create policy user_session_system on user_session for all to app_system
using (app_setting_text('app.scope') = 'system')
with check (app_setting_text('app.scope') = 'system');

create policy user_session_own on user_session for select to app_request
using (app_setting_text('app.scope') = 'store' and user_id = app_setting_uuid('app.user_id'));

create policy request_scope on user_session as restrictive for all to app_request
using (app_setting_text('app.scope') in ('store', 'shop')) with check (app_setting_text('app.scope') in ('store', 'shop'));
create policy partner_scope on user_session as restrictive for all to app_partner
using (app_setting_text('app.scope') = 'partner') with check (app_setting_text('app.scope') = 'partner');
create policy platform_scope on user_session as restrictive for all to app_platform
using (app_setting_text('app.scope') = 'platform') with check (app_setting_text('app.scope') = 'platform');
create policy system_scope on user_session as restrictive for all to app_system
using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
