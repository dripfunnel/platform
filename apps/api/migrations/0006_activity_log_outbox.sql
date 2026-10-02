-- The activity log (LOGGING.md §4) and the outbox (api/README.md §5). Both are written in the
-- same transaction as the change they belong to; neither is ever updated by a request.

-- Partitioned by month (LOGGING.md §1) so §8's retention can drop a month at a time. The
-- partitions below carry it to the end of 2027; the retention job creates the ones after that,
-- and the default partition keeps a late row from failing meanwhile.
create table activity_log (
  id uuid not null default gen_random_uuid(),
  -- Millisecond precision, the same as the keyset cursor (core/cursor.ts), so a page boundary
  -- never falls between two rows the cursor cannot tell apart.
  occurred_at timestamptz(3) not null default now(),
  category text not null check (category in ('auth', 'write', 'support', 'system', 'security')),
  action text not null,
  result text not null check (result in ('success', 'denied', 'failed')),
  actor_kind text not null check (
    actor_kind in ('staff', 'partner_user', 'person', 'customer', 'api_key', 'app_grant', 'support_session', 'job', 'provider', 'anonymous')
  ),
  actor_id text,
  actor_label text,
  on_behalf_of_kind text check (on_behalf_of_kind in ('staff', 'partner_user')),
  on_behalf_of_id text,
  on_behalf_of_label text,
  access_kind text check (access_kind in ('impersonation', 'setup_session', 'support_session')),
  access_ref text,
  partner_id uuid,
  store_id uuid,
  seller_id uuid,
  customer_id uuid,
  target_type text,
  target_id text,
  target_label text,
  changes jsonb not null default '[]'::jsonb,
  reason text,
  api text check (api in ('admin', 'platform', 'store', 'shop', 'system')),
  host text,
  request_id text,
  ip text,
  user_agent text,
  visibility text not null check (visibility in ('staff', 'partner', 'store', 'self')),
  primary key (id, occurred_at),
  constraint activity_log_on_behalf_of check ((on_behalf_of_kind is null) = (on_behalf_of_id is null)),
  constraint activity_log_access check ((access_kind is null) = (access_ref is null)),
  constraint activity_log_target check ((target_type is null) = (target_id is null))
) partition by range (occurred_at);

do $$
declare
  month date := date '2026-09-01';
begin
  while month < date '2028-01-01' loop
    execute format(
      'create table %I partition of activity_log for values from (%L) to (%L)',
      'activity_log_' || to_char(month, 'YYYY_MM'), month, month + interval '1 month');
    month := month + interval '1 month';
  end loop;
end
$$;

create table activity_log_default partition of activity_log default;

-- LOGGING.md §7, plus the unfiltered keyset. Declared on the parent, so every partition has them.
create index activity_log_occurred_idx on activity_log (occurred_at desc, id desc);
create index activity_log_actor_idx on activity_log (actor_kind, actor_id, occurred_at desc, id desc);
create index activity_log_store_idx on activity_log (store_id, occurred_at desc, id desc);
create index activity_log_partner_idx on activity_log (partner_id, occurred_at desc, id desc);
create index activity_log_customer_idx on activity_log (customer_id, occurred_at desc, id desc);
create index activity_log_target_idx on activity_log (target_type, target_id, occurred_at desc, id desc);
create index activity_log_action_idx on activity_log (action, occurred_at desc, id desc);

-- Append-only (LOGGING.md §5): nobody the Worker connects as may update or delete. Granted on
-- the parent only, so a partition cannot be reached except through it.
grant select, insert on activity_log to app_request, app_system;

alter table activity_log enable row level security;
alter table activity_log force row level security;

-- Who sees what (LOGGING.md §6). A partner never sees inside a store; a store never sees
-- another store; a supplier sees only entries made under its seller; a shopper only their own.
-- An account-level entry (`partner` visibility naming a store) is the merchant's too.
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

-- An entry is written in the scope the action ran in, so a caller can only file it against
-- its own partner and store. A partner names one of its own stores or none (the subquery is
-- under the store policy), and never a seller or a shopper, which are inside the store.
create policy activity_log_insert on activity_log for insert
with check (
  app_setting_text('app.scope') in ('platform', 'system')
  or (
    app_setting_text('app.scope') = 'partner'
    and partner_id = app_setting_uuid('app.partner_id')
    and (store_id is null or store_id in (select id from store))
    and seller_id is null
    and customer_id is null
  )
  or (
    app_setting_text('app.scope') in ('store', 'shop')
    and store_id = app_setting_uuid('app.store_id')
    and partner_id = app_setting_uuid('app.partner_id')
    and (app_setting_text('app.seller_id') = '' or seller_id = app_setting_uuid('app.seller_id'))
  )
);

-- Side effects wait here until the transaction that asked for them has committed
-- (api/README.md §5). `idempotency_key` is what stops a retried request queuing the same
-- effect twice; db/scoped/outbox prefixes it with the kind and the scope, so two stores'
-- keys never meet. The relay's own replays are stopped by `delivered_at`. Retention is
-- LOGGING.md §8's.
create table outbox (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null,
  idempotency_key text not null unique,
  payload jsonb not null,
  partner_id uuid,
  store_id uuid,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  last_error text
);

create index outbox_due_idx on outbox (next_attempt_at) where delivered_at is null and failed_at is null;

-- A request may only add to it; the relay (app_system) is the only writer after that.
grant insert on outbox to app_request;
grant select, insert, update on outbox to app_system;

alter table outbox enable row level security;
alter table outbox force row level security;

create policy outbox_insert on outbox for insert
with check (
  app_setting_text('app.scope') in ('platform', 'system')
  or (app_setting_text('app.scope') = 'partner' and partner_id = app_setting_uuid('app.partner_id'))
  or (
    app_setting_text('app.scope') in ('store', 'shop')
    and store_id = app_setting_uuid('app.store_id')
    and partner_id = app_setting_uuid('app.partner_id')
  )
);

create policy outbox_relay on outbox for select
using (app_setting_text('app.scope') = 'system');

create policy outbox_relay_update on outbox for update
using (app_setting_text('app.scope') = 'system')
with check (app_setting_text('app.scope') = 'system');
