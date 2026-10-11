-- INF 3 (#482), part 2: the studio's sessions, its AI runs and the theme's custom paths (DATA-MODEL §7.8; storefront
-- AI-STUDIO.md §3, §4 and §8). Nothing here is destructive: two new tables and one defaulted column.

-- A studio frame's bearer id (AI-STUDIO §8), kept only as its SHA-256. Bound to one store, one user and the portal session
-- that opened it: signing out deletes the user_session row, and with it every studio session it opened.
create table studio_session (
  id_hash text primary key check (id_hash ~ '^[0-9a-f]{64}$'),
  store_id uuid not null references store (id),
  user_id uuid not null references "user" (id),
  user_session_hash text not null references user_session (id_hash) on delete cascade,
  can_change boolean not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index studio_session_store_idx on studio_session (store_id, expires_at);
create index studio_session_user_session_idx on studio_session (user_session_hash);

-- The platform's alone, like storefront_push: the Store API's studio service and the Durable Object, in system scope.
grant select, insert, update, delete on studio_session to app_system;
alter table studio_session enable row level security;
alter table studio_session force row level security;
create policy studio_session_system on studio_session for all to app_system using (true) with check (true);
create policy request_scope on studio_session as restrictive for all to app_request using (false) with check (false);
create policy partner_scope on studio_session as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on studio_session as restrictive for all to app_platform using (false) with check (false);
create policy system_scope on studio_session as restrictive for all to app_system
using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');

-- One model call (SAAS §9.2 metering). A repair is always the platform's cost and always hangs off the run it repairs.
create table ai_run (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  kind text not null check (kind in ('design', 'repair', 'migration', 'description', 'translation')),
  requested_by uuid references "user" (id),
  prompt text not null check (char_length(prompt) <= 4000),
  model text not null check (char_length(model) between 1 and 100),
  tokens_in integer not null check (tokens_in >= 0),
  tokens_out integer not null check (tokens_out >= 0),
  cost_amount bigint not null check (cost_amount >= 0),
  cost_currency text not null check (cost_currency ~ '^[A-Z]{3}$'),
  billed_to text not null check (billed_to in ('plan', 'own_key', 'platform')),
  sandbox_ms integer check (sandbox_ms >= 0),
  repair_attempts integer not null default 0 check (repair_attempts between 0 and 3),
  parent_run_id uuid references ai_run (id),
  outcome text not null check (outcome in ('changed', 'unchanged', 'refused', 'failed')),
  created_at timestamptz not null default now(),
  check (kind <> 'repair' or (billed_to = 'platform' and parent_run_id is not null))
);
create index ai_run_store_idx on ai_run (store_id, created_at desc);
create index ai_run_parent_idx on ai_run (parent_run_id) where parent_run_id is not null;

-- The merchant side reads its own store's runs; the partner's and staff's metering view (DATA-MODEL §5.3) comes with
-- the card that first shows them, so neither reads a prompt before then.
grant select on ai_run to app_request;
grant select, insert on ai_run to app_system;
alter table ai_run enable row level security;
alter table ai_run force row level security;
create policy ai_run_system on ai_run for all to app_system using (true) with check (true);
create policy ai_run_merchant on ai_run for select to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '');
create policy request_scope on ai_run as restrictive for all to app_request
using (app_setting_text('app.scope') = 'store') with check (app_setting_text('app.scope') = 'store');
create policy partner_scope on ai_run as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on ai_run as restrictive for all to app_platform using (false) with check (false);
create policy system_scope on ai_run as restrictive for all to app_system
using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');

-- The theme's own pages' paths from routes.json, written on each accepted change (storefront ARCHITECTURE §3.1), so SAPI 24
-- can refuse a content page or post that takes one.
alter table storefront add column custom_paths text[] not null default '{}';
