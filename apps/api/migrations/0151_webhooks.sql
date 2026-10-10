-- SAPI 20 (#330), part 2: webhooks from the outbox (PLATFORM-PROMPT §5.5; DATA-MODEL §7.10). An endpoint's signing secret
-- is sealed with the credential key and shown once; each event an endpoint takes is one delivery row, sent by the relay.

create table webhook_endpoint (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  url text not null check (url ~ '^https://' and length(url) <= 2000),
  events text[] not null check (cardinality(events) between 1 and 20),
  secret_sealed text not null,
  status text not null default 'active' check (status in ('active', 'failing', 'disabled')),
  failing_since timestamptz(3),
  disabled_at timestamptz(3),
  created_by_user_id uuid not null references "user" (id),
  created_at timestamptz(3) not null default now(),
  updated_at timestamptz(3) not null default now(),
  deleted_at timestamptz(3),
  unique (id, store_id),
  constraint webhook_endpoint_failing check ((status = 'active') = (failing_since is null)),
  constraint webhook_endpoint_disabled check ((status = 'disabled') = (disabled_at is not null))
);

create index webhook_endpoint_store_idx on webhook_endpoint (store_id, created_at desc, id desc) where deleted_at is null;

create table webhook_delivery (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null,
  store_id uuid not null,
  event text not null,
  -- The event's own id: the same for every endpoint it went to and every replay of it.
  event_id uuid not null,
  body text not null,
  status text not null check (status in ('pending', 'delivered', 'failed', 'held')),
  attempts integer not null default 0 check (attempts >= 0),
  response_code integer,
  error text check (error ~ '^[a-z_]{1,40}$'),
  duration_ms integer,
  created_at timestamptz(3) not null default now(),
  last_attempt_at timestamptz(3),
  delivered_at timestamptz(3),
  -- The delivery this one sends again; an id only, so the log's oldest rows can go before their replays.
  replay_of uuid,
  foreign key (endpoint_id, store_id) references webhook_endpoint (id, store_id)
);

-- One first delivery of an event per endpoint, so a fan-out run twice sends it once.
create unique index webhook_delivery_event_key on webhook_delivery (endpoint_id, event_id) where replay_of is null;
create index webhook_delivery_endpoint_idx on webhook_delivery (endpoint_id, created_at desc, id desc);
create index webhook_delivery_held_idx on webhook_delivery (endpoint_id, created_at) where status = 'held';
create index webhook_delivery_age_idx on webhook_delivery (created_at);

-- The merchant side manages endpoints and replays, never reading a secret back; the relay delivers as app_system.
grant select (id, store_id, url, events, status, failing_since, disabled_at, created_by_user_id, created_at, updated_at, deleted_at) on webhook_endpoint to app_request;
grant insert on webhook_endpoint to app_request;
grant update (url, events, status, failing_since, disabled_at, updated_at, deleted_at) on webhook_endpoint to app_request;
grant select, update (status, failing_since, disabled_at, updated_at) on webhook_endpoint to app_system;
grant select, insert on webhook_delivery to app_request;
grant update (status) on webhook_delivery to app_request;
grant select, insert, delete, update (status, attempts, response_code, error, duration_ms, last_attempt_at, delivered_at) on webhook_delivery to app_system;

alter table webhook_endpoint enable row level security;
alter table webhook_endpoint force row level security;
create policy webhook_endpoint_system on webhook_endpoint for all to app_system using (true) with check (true);
create policy webhook_endpoint_store on webhook_endpoint for all to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id'))
with check (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id'));
create policy request_scope on webhook_endpoint as restrictive for all to app_request
using (app_setting_text('app.scope') in ('store', 'shop', 'partner', 'platform'))
with check (app_setting_text('app.scope') in ('store', 'shop', 'partner', 'platform'));
create policy partner_scope on webhook_endpoint as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on webhook_endpoint as restrictive for all to app_platform using (false) with check (false);
create policy system_scope on webhook_endpoint as restrictive for all to app_system
using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
create policy support_no_insert on webhook_endpoint as restrictive for insert to app_request with check (app_setting_text('app.support') = '');
create policy support_no_update on webhook_endpoint as restrictive for update to app_request with check (app_setting_text('app.support') = '');

alter table webhook_delivery enable row level security;
alter table webhook_delivery force row level security;
create policy webhook_delivery_system on webhook_delivery for all to app_system using (true) with check (true);
create policy webhook_delivery_store on webhook_delivery for all to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id'))
with check (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id'));
create policy request_scope on webhook_delivery as restrictive for all to app_request
using (app_setting_text('app.scope') in ('store', 'shop', 'partner', 'platform'))
with check (app_setting_text('app.scope') in ('store', 'shop', 'partner', 'platform'));
create policy partner_scope on webhook_delivery as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on webhook_delivery as restrictive for all to app_platform using (false) with check (false);
create policy system_scope on webhook_delivery as restrictive for all to app_system
using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
create policy support_no_insert on webhook_delivery as restrictive for insert to app_request with check (app_setting_text('app.support') = '');
create policy support_no_update on webhook_delivery as restrictive for update to app_request with check (app_setting_text('app.support') = '');

-- Whether any endpoint of the store takes this event, and the store's partner when one does: a supplier's write (no
-- read of endpoints or of the store row) queues its store's event too. Only the acting store, or any in system scope.
create function store_webhook_partner(p_store uuid, p_event text) returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.partner_id from store s
  where s.id = p_store
    and (p_store = nullif(app_setting_text('app.store_id'), '')::uuid or app_setting_text('app.scope') = 'system')
    and exists (select 1 from webhook_endpoint e where e.store_id = p_store and e.deleted_at is null and p_event = any(e.events))
$$;
grant select (store_id, events, deleted_at) on webhook_endpoint to app_definer;
grant select (id, partner_id) on store to app_definer;
alter function store_webhook_partner(uuid, text) owner to app_definer;
revoke execute on function store_webhook_partner(uuid, text) from public;
grant execute on function store_webhook_partner(uuid, text) to app_request, app_supplier, app_system;
