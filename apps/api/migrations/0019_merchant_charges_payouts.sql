-- What merchants were charged and what partners are paid (SAAS §7.1–§7.2; #163). Stripe Connect
-- fills these in production (THIRD-PARTY-ACCESS §2.7); until then the seed does. The Dashboard
-- reads what was charged, never a plan price times a count (DATA-MODEL §7.9).

-- One merchant charge, in the store's currency, and what it came to in the partner's payout
-- currency: DripFunnel's fee and the partner's share of it. A refund's amounts are positive and
-- are subtracted wherever charges are summed.
create table merchant_charge (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null,
  store_id uuid not null,
  kind text not null check (kind in ('subscription', 'proration', 'refund')),
  status text not null check (status in ('paid', 'failed', 'refunded', 'recovered')),
  amount integer not null check (amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  payout_currency text not null check (payout_currency ~ '^[A-Z]{3}$'),
  payout_gross integer not null check (payout_gross >= 0),
  fee_amount integer not null check (fee_amount >= 0),
  partner_amount integer not null,
  card_last4 text check (card_last4 ~ '^[0-9]{4}$'),
  failure_reason text,
  invoice_id text,
  charged_at timestamptz(3) not null,
  created_at timestamptz(3) not null default now(),
  foreign key (store_id, partner_id) references store (id, partner_id),
  constraint merchant_charge_share check (partner_amount = payout_gross - fee_amount)
);

create index merchant_charge_partner_idx on merchant_charge (partner_id, charged_at desc, id desc);
create index merchant_charge_store_idx on merchant_charge (store_id, charged_at desc);

-- One monthly payout to the partner, in the contract's payout currency.
create table partner_payout (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partner (id),
  period_start date not null,
  period_end date not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  gross integer not null check (gross >= 0),
  fee integer not null check (fee >= 0),
  adjustments integer not null default 0,
  amount integer not null,
  stores integer not null check (stores >= 0),
  status text not null check (status in ('scheduled', 'paid', 'held')),
  scheduled_for date not null,
  paid_at timestamptz,
  held_reason text,
  adjustment_note text,
  unique (partner_id, period_start),
  constraint partner_payout_period check (period_end > period_start),
  constraint partner_payout_amount check (amount = gross - fee + adjustments),
  constraint partner_payout_held check ((status = 'held') = (held_reason is not null))
);

create index partner_payout_partner_idx on partner_payout (partner_id, scheduled_for desc);

-- A store's sales in a month, totals only, in its own currency: the engine's monthly rollup,
-- which is all a partner may see of a merchant's orders (FIRST-RELEASE §5, §10).
create table store_sales_month (
  store_id uuid not null,
  partner_id uuid not null,
  month date not null check (month = date_trunc('month', month)),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount integer not null check (amount >= 0),
  -- The same total in the partner's payout currency, so stores in different currencies rank.
  payout_currency text not null check (payout_currency ~ '^[A-Z]{3}$'),
  payout_amount integer not null check (payout_amount >= 0),
  orders integer not null check (orders >= 0),
  primary key (store_id, month),
  foreign key (store_id, partner_id) references store (id, partner_id)
);

create index store_sales_month_partner_idx on store_sales_month (partner_id, month, payout_amount desc);

-- When the job that fills the tables last finished, and since when the provider has been slow.
create table partner_billing_feed (
  partner_id uuid primary key references partner (id),
  synced_at timestamptz not null,
  stale_since timestamptz
);

grant select on merchant_charge, partner_payout, store_sales_month, partner_billing_feed to app_partner, app_platform;
grant select, insert, update on merchant_charge, partner_payout, store_sales_month, partner_billing_feed to app_system;

do $$
declare
  t text;
begin
  foreach t in array array['merchant_charge', 'partner_payout', 'store_sales_month', 'partner_billing_feed'] loop
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
    -- The partner its own rows; staff and jobs every partner's. No merchant branch yet: the
    -- Store API's billing screen (#201) adds its own.
    execute format('create policy %I on %I for select to app_partner using (partner_id = app_setting_uuid(''app.partner_id''))', t || '_partner_read', t);
    execute format('create policy %I on %I for all to app_platform, app_system using (true) with check (true)', t || '_staff', t);
  end loop;
end
$$;
