-- #1744: a merchant pays its partner for its plan through Razorpay Subscriptions on the partner's own account (SAAS §7.4;
-- DATA-MODEL §7.9). Additive: the previous release reads none of the new rows or columns.

-- The partner's Razorpay keys are one more provider of partner_credential, one row per mode, sealed in key_enc as the
-- other credentials are; `settings` holds the mode.
alter table partner_credential drop constraint partner_credential_kind_provider;
alter table partner_credential add constraint partner_credential_kind_provider check (
  (kind, provider) in (('ai', 'anthropic'), ('ai', 'openai'), ('sms', 'msg91'), ('sms', 'twilio'), ('sms', 'sns'), ('whatsapp', 'meta'), ('maps', 'google'), ('billing', 'razorpay'))
);
-- Billing keys are one account per mode, not per provider (0399's index), so a partner can hold live and test.
drop index partner_credential_account_key;
create unique index partner_credential_account_key on partner_credential (partner_id, kind, provider) where kind not in ('ai', 'billing');
create unique index partner_credential_billing_mode on partner_credential (partner_id, kind, provider, (settings->>'mode')) where kind = 'billing';

-- The store's Razorpay subscription and customer on the partner's account (written in system scope). Razorpay holds the
-- mandate and charges each period; the platform follows it.
alter table store_subscription
  add column razorpay_subscription_id text check (razorpay_subscription_id ~ '^sub_[A-Za-z0-9]{6,40}$'),
  add column razorpay_customer_id text check (razorpay_customer_id ~ '^cust_[A-Za-z0-9]{6,40}$'),
  add column razorpay_mode text check (razorpay_mode in ('live', 'test'));
create unique index store_subscription_razorpay on store_subscription (razorpay_subscription_id) where razorpay_subscription_id is not null;

-- Each partner plan version, interval and price as a Razorpay plan on the partner's account, made once when first needed.
create table razorpay_plan (
  partner_id uuid not null references partner (id),
  mode text not null check (mode in ('live', 'test')),
  plan_id uuid not null,
  plan_version integer not null,
  interval text not null check (interval in ('month', 'year')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount bigint not null check (amount > 0),
  razorpay_plan_id text not null check (razorpay_plan_id ~ '^plan_[A-Za-z0-9]+$'),
  created_at timestamptz not null default now(),
  primary key (partner_id, mode, plan_id, plan_version, interval, currency, amount)
);
create unique index razorpay_plan_id_key on razorpay_plan (partner_id, mode, razorpay_plan_id);

-- Each payment on a store's subscription: the first one that starts it, and each renewal Razorpay charges. One per
-- subscription and period, so a webhook delivered twice records it once. A plan change is a new subscription replacing
-- the store's (change_when: the plan applies now, or at the period's end), its period known before it is approved.
create table store_plan_charge (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  partner_id uuid not null references partner (id),
  kind text not null check (kind in ('subscribe', 'renewal')),
  mode text not null check (mode in ('live', 'test')),
  plan_id uuid not null,
  plan_version integer not null,
  interval text not null check (interval in ('month', 'year')),
  amount bigint not null check (amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  razorpay_subscription_id text not null check (razorpay_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  razorpay_payment_id text check (razorpay_payment_id ~ '^pay_[A-Za-z0-9]+$'),
  period_start timestamptz,
  period_end timestamptz,
  status text not null default 'pending' check (status in ('pending', 'captured')),
  change_when text check (change_when in ('now', 'period_end')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (store_id, partner_id) references store (id, partner_id)
);
create unique index store_plan_charge_subscribe on store_plan_charge (razorpay_subscription_id) where kind = 'subscribe';
create unique index store_plan_charge_period on store_plan_charge (razorpay_subscription_id, period_start) where kind = 'renewal';

grant select, insert, update on razorpay_plan, store_plan_charge to app_system;
do $$
declare
  t text;
begin
  -- Billing's alone: no request, partner or staff role is granted them, and each is pinned to its scope as every table is.
  foreach t in array array['razorpay_plan', 'store_plan_charge'] loop
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
    execute format('create policy %I on %I for all to app_system using (true) with check (true)', t || '_system', t);
  end loop;
end
$$;
