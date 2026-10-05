-- Merchant and supplier sign-in on the portal host (ACCESS.md §2, §4; DATA-MODEL.md §3.3; #290).
-- Everything here is a credential or guards one, so app_system alone reads it; app_request
-- gets no grant on any new column.

alter table "user"
  add column two_factor_method text check (two_factor_method in ('app', 'sms')),
  add column two_factor_enrolled_at timestamptz,
  -- The last TOTP step used, so a code is never accepted twice (as partner_user's).
  add column last_code_step bigint,
  add column failed_code_count integer not null default 0 check (failed_code_count >= 0),
  add column locked_until timestamptz,
  add constraint user_two_factor_whole check ((two_factor_method is null) = (two_factor_enrolled_at is null)),
  add constraint user_two_factor_app check (two_factor_method is distinct from 'app' or two_factor_secret_enc is not null),
  add constraint user_two_factor_sms check (two_factor_method is distinct from 'sms' or phone is not null);

-- A password alone opens a session at a step (second factor, or enrolment for an Owner without
-- one), good for 10 minutes and for nothing but that step (ACCESS.md §4).
alter table user_session
  add column stage text not null default 'full' check (stage in ('second-factor', 'enrol', 'full')),
  add column pending_secret_enc text,
  add column pending_phone text;

-- Ten per enrolment, each used once; shown once and stored hashed (ACCESS.md §4).
create table user_backup_code (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references "user" (id),
  partner_id uuid not null references partner (id),
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index user_backup_code_user_idx on user_backup_code (user_id) where used_at is null;

-- One-time codes sent by SMS (DATA-MODEL.md §3.3): hashed, short-lived, attempt-counted.
create table verification_code (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partner (id),
  subject_kind text not null check (subject_kind in ('user')),
  subject_id uuid not null,
  purpose text not null check (purpose in ('sign_in', 'enrol_phone')),
  code_hash text not null,
  attempts integer not null default 0 check (attempts >= 0),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index verification_code_subject_idx on verification_code (subject_kind, subject_id, purpose, created_at desc);

grant select, insert, update, delete on user_backup_code, verification_code to app_system;
-- A person reads how many backup codes are left on their own profile, never a hash.
grant select (id, user_id, used_at, created_at) on user_backup_code to app_request;

do $$
declare
  t text;
begin
  foreach t in array array['user_backup_code', 'verification_code'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %I on %I for all to app_system using (app_setting_text(''app.scope'') = ''system'') with check (app_setting_text(''app.scope'') = ''system'')', t || '_system', t);
    execute format('create policy request_scope on %I as restrictive for all to app_request
      using (app_setting_text(''app.scope'') in (''store'', ''shop'')) with check (app_setting_text(''app.scope'') in (''store'', ''shop''))', t);
    execute format('create policy partner_scope on %I as restrictive for all to app_partner
      using (app_setting_text(''app.scope'') = ''partner'') with check (app_setting_text(''app.scope'') = ''partner'')', t);
    execute format('create policy platform_scope on %I as restrictive for all to app_platform
      using (app_setting_text(''app.scope'') = ''platform'') with check (app_setting_text(''app.scope'') = ''platform'')', t);
    execute format('create policy system_scope on %I as restrictive for all to app_system
      using (app_setting_text(''app.scope'') = ''system'') with check (app_setting_text(''app.scope'') = ''system'')', t);
  end loop;
end
$$;

create policy user_backup_code_own on user_backup_code for select to app_request
using (app_setting_text('app.scope') = 'store' and user_id = app_setting_uuid('app.user_id'));

-- The portal's support banner (ACCESS.md §8, FIRST-RELEASE §3.3) reads the open session on the
-- acting store; SAPI 21 adds the store side's own policy and the exchange. Read only, by column.
grant select (id, partner_id, store_id, partner_user_id, started_at, expires_at, ended_at) on support_session to app_system;
create policy support_session_system_read on support_session for select to app_system
using (app_setting_text('app.scope') = 'system');
