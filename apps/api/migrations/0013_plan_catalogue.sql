-- The plan catalogue (SAAS.md §6.1, §6.3; DATA-MODEL.md §2.3; #157). A plan's prices, trial and
-- entitlements are versioned: an edit adds a version, and a subscription keeps the one it bought.

-- The house partner's plans carry a 10-day trial (SAAS §6.1, decided 2026-10-02).
alter table plan drop constraint plan_trial_days_check;
alter table plan add constraint plan_trial_days_check check (trial_days between 0 and 90);

alter table plan
  add column version integer not null default 1 check (version >= 1),
  add column retire_at timestamptz,
  add column retire_move_to_plan_id uuid,
  add constraint plan_id_partner_key unique (id, partner_id),
  -- Only one of the same partner's plans can take a retired plan's stores.
  add constraint plan_retire_move_to_fkey foreign key (retire_move_to_plan_id, partner_id) references plan (id, partner_id);

-- partner_id on every child, held to the plan's by the composite keys, so each table's own
-- policy can scope it without a join.
create table plan_version (
  plan_id uuid not null,
  partner_id uuid not null,
  version integer not null check (version >= 1),
  trial_days integer not null check (trial_days between 0 and 90),
  created_at timestamptz not null default now(),
  created_by_kind text check (created_by_kind in ('partner_user', 'staff', 'system')),
  created_by_label text,
  primary key (plan_id, version),
  unique (plan_id, version, partner_id),
  foreign key (plan_id, partner_id) references plan (id, partner_id)
);

-- Every plan already built gets its first version, with its trial and no prices or values:
-- "Not priced" until its partner prices it.
insert into plan_version (plan_id, partner_id, version, trial_days, created_by_kind, created_by_label)
select id, partner_id, 1, trial_days, 'system', 'Migration 0013' from plan;

-- The current version always exists; deferred, because a plan and its first version are
-- written in one transaction.
alter table plan add constraint plan_current_version_fkey foreign key (id, version)
  references plan_version (plan_id, version) deferrable initially deferred;

-- Integer minor units per currency; null is "Not priced" (FIRST-RELEASE §7.1).
create table plan_price (
  plan_id uuid not null,
  partner_id uuid not null,
  version integer not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  monthly_amount integer check (monthly_amount >= 0),
  yearly_amount integer check (yearly_amount >= 0),
  primary key (plan_id, version, currency),
  foreign key (plan_id, version, partner_id) references plan_version (plan_id, version, partner_id)
);

-- SAAS §6.1's three kinds: a switch holds `enabled`, a limit or a monthly allowance `amount`.
create table plan_entitlement (
  plan_id uuid not null,
  partner_id uuid not null,
  version integer not null,
  key text not null check (key in (
    'custom_domain', 'offers', 'suppliers_enabled', 'powered_by_removal', 'aplus', 'size_charts',
    'products', 'staff', 'suppliers', 'languages', 'currencies',
    'publish_now', 'ai_prompts'
  )),
  enabled boolean,
  amount integer check (amount >= 0),
  primary key (plan_id, version, key),
  foreign key (plan_id, version, partner_id) references plan_version (plan_id, version, partner_id),
  constraint plan_entitlement_kind check (
    (key in ('custom_domain', 'offers', 'suppliers_enabled', 'powered_by_removal', 'aplus', 'size_charts'))
    = (enabled is not null and amount is null)
  )
);

-- DripFunnel's wholesale fee per store per month for the plan, in the contract's fee currency.
-- Its own table so a merchant reading its plan never reads the fee (no store policy here).
create table plan_fee (
  plan_id uuid primary key,
  partner_id uuid not null,
  amount integer not null check (amount >= 0),
  foreign key (plan_id, partner_id) references plan (id, partner_id)
);

-- DripFunnel's maximum per limit and allowance; no partner may configure a plan above it (§6.1).
create table plan_ceiling (
  key text primary key check (key in ('products', 'staff', 'suppliers', 'languages', 'currencies', 'publish_now', 'ai_prompts')),
  amount integer not null check (amount >= 0)
);

-- What the partner's contract fixes: the fee currency, whether plans may remove "Powered by"
-- and why not, and the rate a second currency's fee is converted at (FIRST-RELEASE §7.2).
create table partner_contract (
  partner_id uuid primary key references partner (id),
  fee_currency text not null check (fee_currency ~ '^[A-Z]{3}$'),
  powered_by_removable boolean not null default false,
  powered_by_note text check (powered_by_note in ('contract', 'firstYear'))
);

create table partner_contract_rate (
  partner_id uuid not null references partner_contract (partner_id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  -- Units of `currency` per unit of the fee currency: a rate, not money.
  per_fee_unit numeric(14, 6) not null check (per_fee_unit > 0),
  primary key (partner_id, currency)
);

create index plan_version_partner_idx on plan_version (partner_id);
create index plan_price_partner_idx on plan_price (partner_id);
create index plan_entitlement_partner_idx on plan_entitlement (partner_id);
create index plan_fee_partner_idx on plan_fee (partner_id);

-- The partner adds versions to its own plans within the ceilings it reads; a version is never
-- updated once written (SAAS §6.3). The fee, the ceilings and the contract are DripFunnel's
-- (Admin API). A merchant reads its own plan's versions.
grant select, insert on plan_version, plan_price, plan_entitlement to app_partner, app_platform;
grant select on plan_fee, plan_ceiling, partner_contract, partner_contract_rate to app_partner;
grant select, insert, update on plan_fee, plan_ceiling, partner_contract, partner_contract_rate to app_platform;
grant select on plan_version, plan_price, plan_entitlement to app_request;
grant select on plan_version, plan_price, plan_entitlement, plan_fee, plan_ceiling, partner_contract, partner_contract_rate to app_system;

do $$
declare
  t text;
begin
  foreach t in array array['plan_version', 'plan_price', 'plan_entitlement', 'plan_fee', 'plan_ceiling', 'partner_contract', 'partner_contract_rate'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    -- The four pins of 0010 and 0011. No live Worker reads these tables, so app_request has no
    -- platform scope to keep here (#210).
    execute format('create policy request_scope on %I as restrictive for all to app_request
      using (app_setting_text(''app.scope'') in (''store'', ''shop'')) with check (app_setting_text(''app.scope'') in (''store'', ''shop''))', t);
    execute format('create policy partner_scope on %I as restrictive for all to app_partner
      using (app_setting_text(''app.scope'') = ''partner'') with check (app_setting_text(''app.scope'') = ''partner'')', t);
    execute format('create policy platform_scope on %I as restrictive for all to app_platform
      using (app_setting_text(''app.scope'') = ''platform'') with check (app_setting_text(''app.scope'') = ''platform'')', t);
    execute format('create policy system_scope on %I as restrictive for all to app_system
      using (app_setting_text(''app.scope'') = ''system'') with check (app_setting_text(''app.scope'') = ''system'')', t);
    execute format('create policy %I on %I for all to app_platform, app_system using (true) with check (true)', t || '_staff', t);
  end loop;

  -- The partner's own rows: all of them read, the versioned ones written.
  foreach t in array array['plan_version', 'plan_price', 'plan_entitlement', 'plan_fee', 'partner_contract', 'partner_contract_rate'] loop
    execute format('create policy %I on %I for select to app_partner using (partner_id = app_setting_uuid(''app.partner_id''))', t || '_partner_read', t);
  end loop;
  foreach t in array array['plan_version', 'plan_price', 'plan_entitlement'] loop
    execute format('create policy %I on %I for insert to app_partner with check (partner_id = app_setting_uuid(''app.partner_id''))', t || '_partner_insert', t);
    -- A merchant reads the plan its store is on, every version (SAAS §13: "read own plan").
    execute format('create policy %I on %I for select to app_request using (
      app_setting_text(''app.scope'') = ''store'' and app_setting_text(''app.seller_id'') = ''''
      and plan_id in (select plan_id from store where id = app_setting_uuid(''app.store_id''))
    )', t || '_store_read', t);
  end loop;
end
$$;

create policy plan_ceiling_partner_read on plan_ceiling for select to app_partner using (true);
