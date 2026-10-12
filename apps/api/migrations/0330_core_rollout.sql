-- INF 6 (#485), part 2: the fleet's rollouts and each store's upgrade (DATA-MODEL §7.8 "Platform scope", SAAS §10;
-- storefront ARCHITECTURE §7, LIVE-SHOP §8). Nothing here is destructive: two new tables, new nullable or defaulted
-- columns and one widened check.

-- One rollout of a core version across the fleet; one at a time, so no store is upgraded by two at once.
create table core_rollout (
  id uuid primary key default gen_random_uuid(),
  version text not null references core_release (version),
  -- A security fix: forced on every store, with the baseline theme for one that can't take it (ARCHITECTURE §7).
  security boolean not null default false,
  state text not null default 'canary' check (state in ('canary', 'waves', 'paused', 'done', 'rolled_back')),
  -- The phase a paused rollout goes back to.
  paused_state text check (paused_state in ('canary', 'waves')),
  -- How far the waves reach: a store whose position is at most this many in a hundred is in (SAAS §10).
  percent integer not null default 0 check (percent between 0 and 100),
  started_by uuid references staff_user (id),
  reason text not null check (char_length(reason) between 1 and 500),
  started_at timestamptz not null default now(),
  -- Set once the tick has entered every store live on an older core.
  enrolled_at timestamptz,
  finished_at timestamptz,
  check ((state = 'paused') = (paused_state is not null))
);
create unique index core_rollout_one_active on core_rollout ((true)) where state in ('canary', 'waves', 'paused');
create index core_rollout_started_idx on core_rollout (started_at desc, id desc);

-- Each store's upgrade in a rollout and how it ended (CONSOLE-DESIGN L2): live on the new core, migrated by the agent,
-- passed (a major, waiting for the merchant's next publish), pinned to its old core, on the baseline theme, or reverted
-- by the rollout's roll back.
create table core_rollout_store (
  -- Names the store's upgrade Workflow instance.
  id uuid not null unique default gen_random_uuid(),
  rollout_id uuid not null references core_rollout (id),
  store_id uuid not null references store (id),
  -- 0 is a canary; otherwise the store's place, 1 to 100, which the waves' percent reaches.
  position integer not null check (position between 0 and 100),
  from_version text not null check (from_version ~ '^\d+\.\d+\.\d+$'),
  state text not null default 'pending' check (state in ('pending', 'running', 'passed', 'migrated', 'pinned', 'baseline', 'live', 'reverted')),
  -- The last commit tried and its publish run; gate is that run's report (never shown to a partner, DATA-MODEL §7.11).
  commit text check (commit ~ '^[0-9a-f]{40}$'),
  publish_run_id uuid references publish_run (id),
  gate jsonb,
  error text check (error ~ '^[a-z_]{1,40}$'),
  started_at timestamptz,
  finished_at timestamptz,
  primary key (rollout_id, store_id)
);
create index core_rollout_store_store_idx on core_rollout_store (store_id);
create index core_rollout_store_state_idx on core_rollout_store (rollout_id, state, position);
create index core_rollout_store_running_idx on core_rollout_store (state) where state = 'running';

-- A store's theme while a security fix serves the baseline (theme_mode, baseline_reason, and the build of its own theme it
-- replaced), why an upgrade left it on its old core, and a major's passed upgrade that waits for its next publish.
alter table storefront
  add column theme_mode text not null default 'own' check (theme_mode in ('own', 'baseline')),
  add column baseline_reason text check (baseline_reason ~ '^[a-z_]{1,40}$'),
  add column baseline_from_build_id uuid references publish_run (id),
  add column core_pinned_reason text check (core_pinned_reason ~ '^[a-z_]{1,40}$'),
  add column core_upgrade_version text check (core_upgrade_version ~ '^\d+\.\d+\.\d+$'),
  add column core_upgrade_commit text check (core_upgrade_commit ~ '^[0-9a-f]{40}$'),
  add constraint storefront_core_upgrade_whole check ((core_upgrade_version is null) = (core_upgrade_commit is null));

-- A major's upgrade is built and checked, never uploaded (ARCHITECTURE §7); a baseline build may change the look.
alter table publish_run
  add column check_only boolean not null default false check (not check_only or kind = 'upgrade'),
  add column baseline boolean not null default false check (not baseline or kind = 'security');

-- Staff read and steer rollouts (SAAS §13 Fleet: Engineer on call, Super admin); the upgrade Workflow writes every result.
grant select, insert, update on core_rollout to app_platform;
grant select, insert, update on core_rollout to app_system;
alter table core_rollout enable row level security;
alter table core_rollout force row level security;
create policy core_rollout_platform on core_rollout for all to app_platform using (true) with check (true);
create policy core_rollout_system on core_rollout for all to app_system using (true) with check (true);
create policy request_scope on core_rollout as restrictive for all to app_request using (false) with check (false);
create policy partner_scope on core_rollout as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on core_rollout as restrictive for all to app_platform
using (app_setting_text('app.scope') = 'platform') with check (app_setting_text('app.scope') = 'platform');
create policy system_scope on core_rollout as restrictive for all to app_system
using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');

-- Account level (DATA-MODEL §7.11): a partner reads its own stores' state, never the gate's report or the commit.
grant select (rollout_id, store_id, position, from_version, state, error, started_at, finished_at) on core_rollout_store to app_partner;
grant select on core_rollout_store to app_platform;
grant select, insert, update on core_rollout_store to app_system;
alter table core_rollout_store enable row level security;
alter table core_rollout_store force row level security;
create policy core_rollout_store_partner on core_rollout_store for select to app_partner using (store_id in (select id from store));
create policy core_rollout_store_platform on core_rollout_store for select to app_platform using (true);
create policy core_rollout_store_system on core_rollout_store for all to app_system using (true) with check (true);
create policy request_scope on core_rollout_store as restrictive for all to app_request using (false) with check (false);
create policy partner_scope on core_rollout_store as restrictive for all to app_partner
using (app_setting_text('app.scope') = 'partner') with check (false);
create policy platform_scope on core_rollout_store as restrictive for all to app_platform
using (app_setting_text('app.scope') = 'platform') with check (app_setting_text('app.scope') = 'platform');
create policy system_scope on core_rollout_store as restrictive for all to app_system
using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
