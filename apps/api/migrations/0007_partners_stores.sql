-- Partners and stores as the consoles read them (SAAS.md §3.1, §4.2; ui/admin/FIRST-RELEASE.md
-- §4, §5), the people pool and memberships behind a store's owner (DATA-MODEL.md §3.3), partner
-- users (§3.2) and the signup job (SAAS.md §5). State history is the activity log, not a table.

create extension if not exists pg_trgm;

-- Partner (SAAS.md §3.1). `name` is backfilled so the column can be NOT NULL on a table that
-- already has rows. Times that order a list are millisecond-precise, like the keyset cursor
-- (core/cursor.ts).
alter table partner alter column created_at type timestamptz(3);
alter table store alter column created_at type timestamptz(3);

alter table partner
  add column name text,
  add column is_house boolean not null default false,
  add column kind text,
  add column region text,
  add column country text,
  add column state text not null default 'draft'
    check (state in ('draft', 'awaiting', 'live', 'paused', 'offboarding', 'closed')),
  add column product_name text,
  add column primary_color text,
  add column accent_color text,
  add column powered_by text not null default 'on' check (powered_by in ('on', 'off', 'house')),
  add column fallback_sender_accepted boolean not null default false,
  add column submitted_at timestamptz(3),
  add column submitted_by_kind text check (submitted_by_kind in ('partner_user', 'staff')),
  add column submitted_by_label text,
  add column sent_back_reason text,
  add column approved_at timestamptz,
  add column paused_at timestamptz,
  add column pause_reason text;

update partner set name = 'Partner ' || left(id::text, 8) where name is null;
alter table partner alter column name set not null;

create unique index partner_house_key on partner (is_house) where is_house;
create index partner_state_idx on partner (state, created_at desc, id desc);
create index partner_created_idx on partner (created_at desc, id desc);
create index partner_submitted_idx on partner (submitted_at) where state = 'awaiting';
create index partner_name_trgm_idx on partner using gin (name gin_trgm_ops);

-- A partner's team (DATA-MODEL.md §3.2). Sessions, passwords and 2-factor are PAPI 1 and 2's;
-- the columns exist so those cards add no migration to this table.
create table partner_user (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partner (id),
  email text not null,
  name text not null,
  role_key text not null check (
    role_key in ('partner-owner', 'partner-admin', 'partner-support', 'partner-finance', 'partner-read-only')
  ),
  status text not null check (status in ('invited', 'active', 'suspended')),
  password_hash text,
  two_factor_secret_enc text,
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now()
);

-- An address is one account whatever its case.
create unique index partner_user_email_key on partner_user (partner_id, lower(email));
create index partner_user_partner_id_idx on partner_user (partner_id);
create index partner_user_email_trgm_idx on partner_user using gin (email gin_trgm_ops);

-- Invitations into a partner's team (ACCESS.md §6). `sent_at` null is a held invitation
-- (FIRST-RELEASE §4.3); a new row replaces an old one, which is revoked.
create table partner_invitation (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partner (id),
  partner_user_id uuid not null references partner_user (id),
  token_hash text unique,
  expires_at timestamptz,
  sent_at timestamptz,
  invited_by_kind text not null check (invited_by_kind in ('partner_user', 'staff')),
  invited_by_label text not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index partner_invitation_user_idx on partner_invitation (partner_user_id, created_at desc);

-- The four hostnames of SAAS.md §3.5, in the states of §8.
create table partner_domain (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partner (id),
  kind text not null check (kind in ('portal', 'preview', 'shops', 'email')),
  host text not null,
  status text not null check (status in ('waiting', 'verifying', 'issuing', 'live', 'failed', 'expiring', 'broken')),
  record_type text not null check (record_type in ('CNAME', 'TXT')),
  expected text not null,
  found text,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (partner_id, kind)
);

create unique index partner_domain_host_key on partner_domain (lower(host));
create index partner_domain_status_idx on partner_domain (status);

-- The setup checklist (SAAS.md §3.2, ui/platform/FIRST-RELEASE.md §4), one row per item.
create table partner_setup_item (
  partner_id uuid not null references partner (id),
  item text not null check (
    item in ('company', 'branding', 'portalHost', 'wildcards', 'emailSender', 'plan', 'legal', 'paymentMethod', 'payoutDetails', 'testSignup')
  ),
  status text not null check (status in ('done', 'progress', 'missing')),
  detail text,
  done_by_kind text check (done_by_kind in ('partner_user', 'staff')),
  done_by_label text,
  done_at timestamptz,
  primary key (partner_id, item),
  constraint partner_setup_item_done check ((status = 'done') = (done_at is not null))
);

-- The plan a store is on, by name and status (SAAS.md §6.1). Prices, entitlements and versions
-- are PAPI 3's; the admin console shows "Not priced" until then.
create table plan (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partner (id),
  name text not null,
  description text,
  status text not null default 'draft' check (status in ('draft', 'live', 'retired')),
  trial_days integer not null default 14 check (trial_days in (0, 7, 14, 30)),
  max_products integer,
  max_staff integer,
  created_at timestamptz not null default now(),
  unique (partner_id, name)
);

create index plan_partner_id_idx on plan (partner_id, status);

-- Store (SAAS.md §4.2; FIRST-RELEASE §5.1, §5.2). A suspended store keeps the status it had, so
-- Restore puts it back exactly (decided on #20).
alter table store
  add column name text,
  add column code text,
  add column country text,
  add column status text not null default 'trial'
    check (status in ('trial', 'active', 'past_due', 'suspended', 'cancelled', 'closed')),
  add column plan_id uuid references plan (id),
  add column trial_ends_at timestamptz,
  add column past_due_since timestamptz,
  add column suspended_at timestamptz,
  add column suspended_reason text,
  add column suspended_by_label text,
  add column suspended_previous_status text
    check (suspended_previous_status in ('trial', 'active', 'past_due')),
  add column cancelled_at timestamptz,
  add column closed_at timestamptz,
  add column storefront_kind text not null default 'ai' check (storefront_kind in ('ai', 'own')),
  add column build_state text check (build_state in ('live', 'building', 'failed')),
  add column core_version text,
  add column last_build_at timestamptz,
  add column last_publish_at timestamptz,
  -- USERS-AND-DOMAINS §4.1: the merchant's standing consent to partner support, on by default.
  add column support_access_allowed boolean not null default true,
  add constraint store_suspended check (
    (status = 'suspended') = (suspended_at is not null and suspended_reason is not null and suspended_previous_status is not null)
  ),
  -- A store with its own frontend has no build; an AI storefront has none until its job starts one.
  add constraint store_build_state check (storefront_kind <> 'own' or build_state is null);

update store set name = 'Store ' || left(id::text, 8), code = 'store-' || left(id::text, 8) where name is null;
alter table store alter column name set not null;
alter table store alter column code set not null;

create unique index store_code_key on store (partner_id, code);
create index store_created_idx on store (created_at desc, id desc);
create index store_partner_created_idx on store (partner_id, created_at desc, id desc);
create index store_status_idx on store (status, created_at desc, id desc);
create index store_partner_status_idx on store (partner_id, status);
create index store_build_state_idx on store (build_state) where build_state is not null;
create index store_storefront_kind_idx on store (storefront_kind);
create index store_trial_ends_idx on store (trial_ends_at) where status = 'trial';
create index store_name_trgm_idx on store using gin (name gin_trgm_ops);
create index store_code_trgm_idx on store using gin (code gin_trgm_ops);

-- A merchant's own hostname (SAAS.md §8). Hostnames are global, so the host is unique.
create table custom_domain (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  host text not null,
  status text not null check (status in ('waiting', 'verifying', 'issuing', 'live', 'failed', 'expiring', 'broken')),
  expected_cname text not null,
  found_cname text,
  ownership_token text not null,
  ownership_found text,
  checked_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index custom_domain_host_key on custom_domain (lower(host));
create index custom_domain_store_id_idx on custom_domain (store_id);
create index custom_domain_status_idx on custom_domain (status);
create index custom_domain_host_trgm_idx on custom_domain using gin (host gin_trgm_ops);

-- The people pool and memberships (DATA-MODEL.md §3.3), structurally: enough for a store's
-- owner and people list. Passwords, sign-in and verification are the Store API's cards.
create table "user" (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partner (id),
  email text not null,
  email_verified_at timestamptz,
  password_hash text,
  name text not null,
  phone text,
  two_factor_secret_enc text,
  status text not null check (status in ('invited', 'active', 'suspended', 'deleted')),
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index user_email_key on "user" (partner_id, lower(email));
create index user_email_trgm_idx on "user" using gin (email gin_trgm_ops);

create table membership (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references "user" (id),
  store_id uuid not null references store (id),
  seller_id uuid references seller (id),
  role_key text not null,
  status text not null check (status in ('invited', 'active', 'suspended')),
  invited_by_user_id uuid references "user" (id),
  created_at timestamptz not null default now(),
  constraint membership_role check (
    (seller_id is null and role_key in ('owner', 'manager', 'staff'))
    or (seller_id is not null and role_key in ('supplier-admin', 'supplier-member'))
  )
);

create unique index membership_merchant_key on membership (user_id, store_id) where seller_id is null;
create unique index membership_supplier_key on membership (user_id, seller_id) where seller_id is not null;
create index membership_store_id_idx on membership (store_id, seller_id);
create index membership_user_id_idx on membership (user_id);

-- DATA-MODEL.md §3.3: a seller belongs to the membership's store, the user to the store's
-- partner, and nobody is both the merchant's staff and a supplier in the same store. Composite
-- keys would need both parents to carry redundant columns; a trigger keeps the invariants with
-- the schema as written. It runs as the owner, so RLS does not hide the rows it checks.
create function membership_check_parents() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  store_partner uuid;
  user_partner uuid;
  seller_store uuid;
begin
  select partner_id into store_partner from store where id = new.store_id;
  select partner_id into user_partner from "user" where id = new.user_id;
  if store_partner is distinct from user_partner then
    raise exception 'membership: the user belongs to another partner than the store';
  end if;
  if new.seller_id is not null then
    select store_id into seller_store from seller where id = new.seller_id;
    if seller_store is distinct from new.store_id then
      raise exception 'membership: the seller belongs to another store';
    end if;
  end if;
  if exists (
    select 1 from membership m
    where m.user_id = new.user_id and m.store_id = new.store_id and m.id is distinct from new.id
      and (m.seller_id is null) <> (new.seller_id is null)
  ) then
    raise exception 'membership: a person is never both the merchant''s staff and a supplier in one store';
  end if;
  return new;
end
$$;

create trigger membership_parents before insert or update on membership
for each row execute function membership_check_parents();

create table invitation (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  seller_id uuid references seller (id),
  email text not null,
  role_key text not null,
  token_hash text unique,
  expires_at timestamptz not null,
  invited_by_user_id uuid references "user" (id),
  invited_by_label text not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index invitation_store_id_idx on invitation (store_id, created_at desc);

-- The signup job (SAAS.md §5). `steps` is this run's own list, three for a store with its own
-- frontend; whether a running step is stuck is the service's answer from a limit per step
-- (decided on #43), not a state here.
create table job (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  kind text not null check (kind in ('provision-store')),
  state text not null check (state in ('running', 'failed', 'cleaning', 'done', 'undone')),
  steps text[] not null,
  step text not null,
  step_started_at timestamptz not null default now(),
  attempts integer not null default 1,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  -- Plain words, which the merchant and the partner read (FIRST-RELEASE §7).
  last_error text,
  constraint job_step_in_steps check (step = any (steps))
);

create index job_store_id_idx on job (store_id, started_at desc);
create index job_state_idx on job (state, started_at desc, id desc) where state <> 'done';
create index job_step_idx on job (step) where state <> 'done';

-- The raw detail and the compensation log name providers and infrastructure, so they are
-- staff's alone (FIRST-RELEASE §7, decided on #43): a table of their own with no store or
-- partner branch, rather than columns a merchant could select.
create table job_detail (
  job_id uuid primary key references job (id),
  details text,
  compensation_log jsonb not null default '[]'::jsonb
);

-- Internal staff notes on a store, never shown to a partner or merchant (FIRST-RELEASE §5.2).
create table store_note (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  staff_user_id uuid not null references staff_user (id),
  text text not null check (char_length(text) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index store_note_store_id_idx on store_note (store_id, created_at desc);

-- Grants (DATA-MODEL.md §5.3): requests read and write under RLS and never delete; jobs and
-- sign-in work as app_system. Staff notes are platform-only, so no system grant.
grant select, insert, update on partner_domain, partner_setup_item, plan, custom_domain, membership, job, job_detail, store_note to app_request;
grant select, insert, update on partner_user, partner_invitation, partner_domain, partner_setup_item, plan,
  custom_domain, "user", membership, invitation, job, job_detail to app_system;
grant select, insert, update on partner, store to app_system;

-- Credentials are never readable by a request (ACCESS.md §5.5, LOGGING.md §4.1): a password
-- hash, a 2-factor secret or an invitation token is granted column by column to everything
-- but app_request, which may insert a row and read or change the rest of it. Sign-in and
-- acceptance read them as app_system.
grant insert on partner_user, partner_invitation, "user", invitation to app_request;
grant select (id, partner_id, email, name, role_key, status, last_sign_in_at, created_at),
      update (email, name, role_key, status, last_sign_in_at) on partner_user to app_request;
grant select (id, partner_id, partner_user_id, expires_at, sent_at, invited_by_kind, invited_by_label, accepted_at, revoked_at, created_at),
      update (expires_at, sent_at, accepted_at, revoked_at) on partner_invitation to app_request;
grant select (id, partner_id, email, email_verified_at, name, phone, status, last_sign_in_at, created_at),
      update (email, email_verified_at, name, phone, status, last_sign_in_at) on "user" to app_request;
grant select (id, store_id, seller_id, email, role_key, expires_at, invited_by_user_id, invited_by_label, accepted_at, revoked_at, created_at),
      update (expires_at, accepted_at, revoked_at) on invitation to app_request;

alter table partner_user enable row level security;
alter table partner_invitation enable row level security;
alter table partner_domain enable row level security;
alter table partner_setup_item enable row level security;
alter table plan enable row level security;
alter table custom_domain enable row level security;
alter table "user" enable row level security;
alter table membership enable row level security;
alter table invitation enable row level security;
alter table job enable row level security;
alter table job_detail enable row level security;
alter table store_note enable row level security;

alter table partner_user force row level security;
alter table partner_invitation force row level security;
alter table partner_domain force row level security;
alter table partner_setup_item force row level security;
alter table plan force row level security;
alter table custom_domain force row level security;
alter table "user" force row level security;
alter table membership force row level security;
alter table invitation force row level security;
alter table job force row level security;
alter table job_detail force row level security;
alter table store_note force row level security;

-- Jobs and sign-in run before a scope exists (0004), so the partner and store rows need a
-- system branch now that provisioning writes them.
create policy partner_system on partner for all
using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
create policy store_system on store for all
using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');

-- Partner-scoped tables (DATA-MODEL.md §5.2): the partner's own rows, or the Admin API, or a job.
do $$
declare
  t text;
begin
  foreach t in array array['partner_user', 'partner_invitation', 'partner_domain', 'partner_setup_item', 'plan'] loop
    execute format(
      'create policy %I_read on %I for select using (
         (app_setting_text(''app.scope'') = ''partner'' and partner_id = app_setting_uuid(''app.partner_id''))
         or app_setting_text(''app.scope'') in (''platform'', ''system''))', t, t);
    execute format(
      'create policy %I_insert on %I for insert with check (
         (app_setting_text(''app.scope'') = ''partner'' and partner_id = app_setting_uuid(''app.partner_id''))
         or app_setting_text(''app.scope'') in (''platform'', ''system''))', t, t);
    execute format(
      'create policy %I_update on %I for update using (
         (app_setting_text(''app.scope'') = ''partner'' and partner_id = app_setting_uuid(''app.partner_id''))
         or app_setting_text(''app.scope'') in (''platform'', ''system''))
       with check (
         (app_setting_text(''app.scope'') = ''partner'' and partner_id = app_setting_uuid(''app.partner_id''))
         or app_setting_text(''app.scope'') in (''platform'', ''system''))', t, t);
  end loop;
end
$$;

-- A store reads its own plan (SAAS.md §13: "read own plan and usage"), never another's.
create policy plan_store_read on plan for select
using (
  app_setting_text('app.scope') = 'store'
  and app_setting_text('app.seller_id') = ''
  and id = (select plan_id from store where id = app_setting_uuid('app.store_id'))
);

-- Account-level store tables (DATA-MODEL.md §5.2): read by the store's merchant side, its
-- partner (through the store policy, so only its own stores), the Admin API and jobs.
do $$
declare
  t text;
begin
  foreach t in array array['custom_domain', 'job'] loop
    execute format(
      'create policy %I_read on %I for select using (
         (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'')
            and app_setting_text(''app.seller_id'') = '''')
         or (app_setting_text(''app.scope'') = ''partner'' and store_id in (select id from store))
         or app_setting_text(''app.scope'') in (''platform'', ''system''))', t, t);
  end loop;
end
$$;

-- The merchant connects and re-checks its own domain (SAAS.md §8); the signup job is written
-- only by the platform (ACCESS.md §5.5: no write to store lifecycle fields).
create policy custom_domain_write on custom_domain for insert
with check (
  (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '')
  or app_setting_text('app.scope') in ('platform', 'system')
);

create policy custom_domain_update on custom_domain for update
using (
  (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '')
  or app_setting_text('app.scope') in ('platform', 'system')
)
with check (
  (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '')
  or app_setting_text('app.scope') in ('platform', 'system')
);

create policy job_write on job for insert with check (app_setting_text('app.scope') in ('platform', 'system'));
create policy job_update on job for update
using (app_setting_text('app.scope') in ('platform', 'system'))
with check (app_setting_text('app.scope') in ('platform', 'system'));

-- People (DATA-MODEL.md §3.3). Inside the store a person is listed through a membership of the
-- acting store, and a supplier sees only its own team (ACCESS.md §5.5). The partner reads its
-- stores' people at account level, names and roles, for contacts and support sessions
-- (ui/platform/FIRST-RELEASE.md §6.3, §12.1; USERS-AND-DOMAINS §4); staff read everyone for the
-- Users tab. Writes come from jobs, sign-up and the Admin API until the Store API's people cards.
create policy membership_read on membership for select
using (
  (
    app_setting_text('app.scope') = 'store'
    and store_id = app_setting_uuid('app.store_id')
    and (app_setting_text('app.seller_id') = '' or seller_id = app_setting_uuid('app.seller_id'))
  )
  or (app_setting_text('app.scope') = 'partner' and store_id in (select id from store))
  or app_setting_text('app.scope') in ('platform', 'system')
);

create policy membership_write on membership for insert
with check (
  (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '')
  or app_setting_text('app.scope') in ('platform', 'system')
);

create policy membership_update on membership for update
using (
  (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '')
  or app_setting_text('app.scope') in ('platform', 'system')
)
with check (
  (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '')
  or app_setting_text('app.scope') in ('platform', 'system')
);

create policy user_read on "user" for select
using (
  (
    app_setting_text('app.scope') = 'store'
    and id in (select user_id from membership)
  )
  or (app_setting_text('app.scope') = 'partner' and partner_id = app_setting_uuid('app.partner_id'))
  or app_setting_text('app.scope') in ('platform', 'system')
);

create policy user_write on "user" for insert
with check (app_setting_text('app.scope') in ('platform', 'system'));

create policy user_update on "user" for update
using (app_setting_text('app.scope') in ('platform', 'system'))
with check (app_setting_text('app.scope') in ('platform', 'system'));

create policy invitation_read on invitation for select
using (
  (
    app_setting_text('app.scope') = 'store'
    and store_id = app_setting_uuid('app.store_id')
    and (app_setting_text('app.seller_id') = '' or seller_id = app_setting_uuid('app.seller_id'))
  )
  or app_setting_text('app.scope') in ('platform', 'system')
);

create policy invitation_write on invitation for insert
with check (
  (
    app_setting_text('app.scope') = 'store'
    and store_id = app_setting_uuid('app.store_id')
    and (app_setting_text('app.seller_id') = '' or seller_id = app_setting_uuid('app.seller_id'))
  )
  or app_setting_text('app.scope') in ('platform', 'system')
);

create policy invitation_update on invitation for update
using (
  (
    app_setting_text('app.scope') = 'store'
    and store_id = app_setting_uuid('app.store_id')
    and (app_setting_text('app.seller_id') = '' or seller_id = app_setting_uuid('app.seller_id'))
  )
  or app_setting_text('app.scope') in ('platform', 'system')
)
with check (
  (
    app_setting_text('app.scope') = 'store'
    and store_id = app_setting_uuid('app.store_id')
    and (app_setting_text('app.seller_id') = '' or seller_id = app_setting_uuid('app.seller_id'))
  )
  or app_setting_text('app.scope') in ('platform', 'system')
);

-- Staff only: no partner, store or system branch at all.
create policy store_note_read on store_note for select using (app_setting_text('app.scope') = 'platform');
create policy store_note_write on store_note for insert with check (app_setting_text('app.scope') = 'platform');

-- Staff read the raw detail; the job that produced it writes it.
create policy job_detail_read on job_detail for select using (app_setting_text('app.scope') in ('platform', 'system'));
create policy job_detail_write on job_detail for insert with check (app_setting_text('app.scope') in ('platform', 'system'));
create policy job_detail_update on job_detail for update
using (app_setting_text('app.scope') in ('platform', 'system')) with check (app_setting_text('app.scope') in ('platform', 'system'));

-- Read-only support sessions are refused every write here too (0003).
do $$
declare
  t text;
begin
  foreach t in array array[
    'partner_user', 'partner_invitation', 'partner_domain', 'partner_setup_item', 'plan',
    'custom_domain', 'user', 'membership', 'invitation', 'job', 'job_detail', 'store_note'
  ] loop
    execute format(
      'create policy support_no_insert on %I as restrictive for insert
         with check (app_setting_text(''app.support'') <> ''read'')', t);
    execute format(
      'create policy support_no_update on %I as restrictive for update
         with check (app_setting_text(''app.support'') <> ''read'')', t);
    execute format(
      'create policy support_no_delete on %I as restrictive for delete
         using (app_setting_text(''app.support'') <> ''read'')', t);
  end loop;
end
$$;

-- Two policies from earlier migrations, replaced rather than edited: 0003 and 0006 have run on
-- the dev database already.

-- LOGGING.md §6: an account-level entry (`partner` visibility naming a store) is the merchant's
-- too, so the store branch reads it.
drop policy activity_log_read on activity_log;
create policy activity_log_read on activity_log for select
using (
  app_setting_text('app.scope') in ('platform', 'system')
  or (
    app_setting_text('app.scope') = 'partner'
    and visibility = 'partner'
    and partner_id = app_setting_uuid('app.partner_id')
  )
  or (
    app_setting_text('app.scope') = 'store'
    and visibility in ('partner', 'store', 'self')
    and store_id = app_setting_uuid('app.store_id')
    and (app_setting_text('app.seller_id') = '' or seller_id = app_setting_uuid('app.seller_id'))
  )
  or (
    app_setting_text('app.scope') = 'shop'
    and visibility = 'self'
    and store_id = app_setting_uuid('app.store_id')
    and customer_id = app_setting_uuid('app.customer_id')
  )
);

-- A supplier's name and status are account-level facts about a store's people (the Users tab,
-- FIRST-RELEASE §5.2; the Support tab, ui/platform/FIRST-RELEASE.md §6.3): the partner reads its
-- stores' suppliers and staff read every one. Inside the store nothing changes: a supplier still
-- reads only its own row (ACCESS.md §5.5). Decided on #32; DATA-MODEL.md §2.
drop policy seller_read on seller;
create policy seller_read on seller for select
using (
  (
    app_setting_text('app.scope') = 'store'
    and store_id = app_setting_uuid('app.store_id')
    and (app_setting_text('app.seller_id') = '' or id = app_setting_uuid('app.seller_id'))
  )
  or (app_setting_text('app.scope') = 'partner' and store_id in (select id from store))
  or app_setting_text('app.scope') in ('platform', 'system')
);
