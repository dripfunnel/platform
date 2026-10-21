-- The store account fields the partner console reads beyond #32 (DATA-MODEL.md §7.9, §2.4;
-- #212): the subscription, limit overrides, trial extensions, who bills, and stored usage.

-- SAAS §7.1: DripFunnel bills the partner's merchants, or the partner bills them itself and
-- sets each store's billing status (ui/platform/FIRST-RELEASE.md §11.4).
alter table partner add column billing_mode text not null default 'dripfunnel' check (billing_mode in ('dripfunnel', 'own'));
alter table store add column billing_status text check (billing_status in ('active', 'past_due', 'suspended'));

-- Whoever writes it, the status is only a self-billing partner's to hold. Owned by app_definer,
-- since the writer's role may not read the partner row.
create function store_billing_status_own_billing() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.billing_status is not null and (tg_op = 'INSERT' or new.billing_status is distinct from old.billing_status)
     and (select billing_mode from partner where id = new.partner_id) <> 'own' then
    raise exception 'store: billing status is set only when the partner bills its merchants' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger store_billing_status_own before insert or update of billing_status on store
for each row execute function store_billing_status_own_billing();

grant select on partner to app_definer;
alter function store_billing_status_own_billing() owner to app_definer;
revoke all on function store_billing_status_own_billing() from public;

-- A child carries its partner so a composite key can hold its plan to the same partner.
create unique index store_id_partner_key on store (id, partner_id);

-- DATA-MODEL §7.9 as designed. A store built before this card has no row until billing (#201)
-- creates one; nothing reads a missing row as a status.
create table store_subscription (
  store_id uuid primary key,
  partner_id uuid not null,
  plan_id uuid not null,
  plan_version integer not null,
  status text not null check (status in ('trial', 'active', 'past_due', 'cancelled')),
  interval text not null check (interval in ('month', 'year')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount integer not null check (amount >= 0),
  period_start timestamptz not null,
  period_end timestamptz not null,
  trial_ends_at timestamptz,
  cancel_at timestamptz,
  -- A scheduled change (SAAS §6.3): a downgrade at period end, or a plan edit applied at renewal.
  next_plan_id uuid,
  next_plan_version integer,
  change_at timestamptz,
  stripe_customer_id text,
  stripe_subscription_id text,
  payment_method_label text,
  payment_method_brand text,
  payment_method_last4 text check (payment_method_last4 ~ '^[0-9]{4}$'),
  payment_method_expires date,
  -- Foreign keys skip RLS, so the partner is part of each: a store's plan is its own partner's.
  foreign key (store_id, partner_id) references store (id, partner_id),
  foreign key (plan_id, plan_version, partner_id) references plan_version (plan_id, version, partner_id),
  foreign key (next_plan_id, next_plan_version, partner_id) references plan_version (plan_id, version, partner_id),
  constraint store_subscription_next check ((next_plan_id is null) = (next_plan_version is null) and (next_plan_id is null) = (change_at is null)),
  constraint store_subscription_period check (period_end > period_start)
);

create index store_subscription_plan_idx on store_subscription (plan_id, plan_version);
create index store_subscription_change_idx on store_subscription (change_at) where change_at is not null;

-- SAAS §6.1: one store's limit raised or lowered, for this month or until removed, with why and who.
create table store_limit_override (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  key text not null check (key in ('products', 'staff', 'suppliers', 'languages', 'currencies', 'publish_now', 'ai_prompts')),
  amount integer not null check (amount >= 0),
  duration text not null check (duration in ('month', 'always')),
  -- The month a 'month' override applies to; null for 'always'.
  month date check (month = date_trunc('month', month)),
  reason text not null check (char_length(reason) between 1 and 500),
  created_by_kind text not null check (created_by_kind in ('partner_user', 'staff')),
  created_by_label text not null,
  created_at timestamptz(3) not null default now(),
  removed_at timestamptz,
  removed_by_label text,
  constraint store_limit_override_month check ((duration = 'month') = (month is not null))
);

create index store_limit_override_store_idx on store_limit_override (store_id, created_at desc) where removed_at is null;

create table store_trial_extension (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  days integer not null check (days between 1 and 90),
  ends_at timestamptz not null,
  reason text not null check (char_length(reason) between 1 and 500),
  created_by_kind text not null check (created_by_kind in ('partner_user', 'staff')),
  created_by_label text not null,
  created_at timestamptz(3) not null default now()
);

create index store_trial_extension_store_idx on store_trial_extension (store_id, created_at desc);

-- "4,210 of 5,000 products" is a stored number written where the work happens, never a count
-- across tenants. Meters carry the period they count (SAAS §6.2).
create table store_usage (
  store_id uuid not null references store (id),
  key text not null check (key in ('products', 'staff', 'suppliers', 'languages', 'currencies', 'publish_now', 'ai_prompts')),
  used integer not null default 0 check (used >= 0),
  period_start date,
  updated_at timestamptz not null default now(),
  primary key (store_id, key)
);

-- FIRST-RELEASE §6.1's filters and sorts, scoped by partner (status, created and the search
-- trigram indexes exist from 0007).
create index store_partner_plan_idx on store (partner_id, plan_id, created_at desc, id desc);
create index store_partner_storefront_idx on store (partner_id, storefront_kind, build_state);
create index store_usage_key_idx on store_usage (key, store_id);

-- The subscription is billing's (#201) and staff's to write; a partner reads it (§7.9), and a
-- plan change (#160) decides its own path. Overrides and extensions are a record: added, an
-- override removed, never rewritten.
grant select on store_limit_override, store_trial_extension, store_usage to app_partner, app_platform;
grant select on store_subscription to app_platform;
-- By column (§7.9): the partner reads status and amounts and the card's last four; the
-- merchant its own billing screen too, never the Stripe ids. The merchant also reads what
-- changed its limits and trial, never the partner's reason or who wrote it.
grant select (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end,
  trial_ends_at, cancel_at, next_plan_id, next_plan_version, change_at, payment_method_last4) on store_subscription to app_partner;
grant select (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end,
  trial_ends_at, cancel_at, next_plan_id, next_plan_version, change_at, payment_method_brand, payment_method_last4,
  payment_method_expires) on store_subscription to app_request;
grant select on store_usage to app_request;
grant select (id, store_id, key, amount, duration, month, created_at, removed_at) on store_limit_override to app_request;
grant select (id, store_id, days, ends_at, created_at) on store_trial_extension to app_request;
grant insert on store_limit_override, store_trial_extension to app_partner, app_platform;
grant update (removed_at, removed_by_label) on store_limit_override to app_partner, app_platform;
grant select, insert, update on store_subscription, store_usage to app_system;
grant insert, update on store_subscription to app_platform;
grant select, insert on store_limit_override, store_trial_extension to app_system;

do $$
declare
  t text;
begin
  foreach t in array array['store_subscription', 'store_limit_override', 'store_trial_extension', 'store_usage'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy request_scope on %I as restrictive for all to app_request
      using (app_setting_text(''app.scope'') in (''store'', ''shop'')) with check (app_setting_text(''app.scope'') in (''store'', ''shop''))', t);
    execute format('create policy partner_scope on %I as restrictive for all to app_partner
      using (app_setting_text(''app.scope'') = ''partner'') with check (app_setting_text(''app.scope'') = ''partner'')', t);
    execute format('create policy platform_scope on %I as restrictive for all to app_platform
      using (app_setting_text(''app.scope'') = ''platform'') with check (app_setting_text(''app.scope'') = ''platform'')', t);
    execute format('create policy system_scope on %I as restrictive for all to app_system
      using (app_setting_text(''app.scope'') = ''system'') with check (app_setting_text(''app.scope'') = ''system'')', t);
    -- Account level (DATA-MODEL §2): the store's merchant side reads its own; the partner its
    -- own stores', through the store policy; staff and jobs everything.
    execute format('create policy %I on %I for select to app_request using (
      app_setting_text(''app.scope'') = ''store'' and app_setting_text(''app.seller_id'') = ''''
      and store_id = app_setting_uuid(''app.store_id''))', t || '_store_read', t);
    execute format('create policy %I on %I for all to app_partner using (store_id in (select id from store)) with check (store_id in (select id from store))', t || '_partner', t);
    execute format('create policy %I on %I for all to app_platform, app_system using (true) with check (true)', t || '_staff', t);
  end loop;
end
$$;

-- The record holds (SAAS §6.1, LOGGING §4): who wrote a row is the writing role's kind, and an
-- override is removed once, with who removed it, and never changed after.
create function store_record_guard() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if (current_user = 'app_partner' and new.created_by_kind <> 'partner_user') or (current_user = 'app_platform' and new.created_by_kind <> 'staff') then
      raise exception '%: created_by_kind must be the writer''s own', tg_table_name using errcode = 'check_violation';
    end if;
  elsif old.removed_at is not null or new.removed_at is null or coalesce(new.removed_by_label, '') = '' then
    raise exception 'store_limit_override: removed once, with who removed it, and never changed after' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger store_limit_override_guard before insert or update on store_limit_override
for each row execute function store_record_guard();
create trigger store_trial_extension_guard before insert on store_trial_extension
for each row execute function store_record_guard();
