-- Billing on the Platform API (SAAS §7.1–§7.2, ui/platform/FIRST-RELEASE.md §11, §14.3; #201):
-- the partner's Stripe Connect account, its payout account and card (Stripe's last 4 only), what
-- DripFunnel invoices it, the webhook's idempotency record, and the retry and Stripe ids the
-- webhook keeps on #163's charges and payouts.

-- Who bills the merchants is the partner's own choice (billing.write: Owner, Finance).
grant update (billing_mode) on partner to app_partner;

-- One per partner. Never a bank account or card number: Stripe holds them, behind tokens made in
-- the browser (THIRD-PARTY-ACCESS §2.7).
create table partner_billing_account (
  partner_id uuid primary key references partner (id),
  stripe_account_id text unique check (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  stripe_customer_id text unique check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  payout_bank text check (char_length(payout_bank) <= 100),
  payout_last4 text check (payout_last4 ~ '^[0-9]{4}$'),
  payout_status text not null default 'missing' check (payout_status in ('missing', 'verifying', 'verified', 'failed')),
  payout_failure text check (char_length(payout_failure) <= 300),
  card_brand text check (char_length(card_brand) <= 30),
  card_last4 text check (card_last4 ~ '^[0-9]{4}$'),
  card_expires date,
  card_status text not null default 'missing' check (card_status in ('missing', 'on_file', 'declined')),
  updated_at timestamptz(3) not null default now(),
  constraint partner_billing_payout_known check ((payout_status = 'missing') = (payout_last4 is null)),
  constraint partner_billing_card_known check ((card_status = 'missing') = (card_last4 is null))
);

-- DripFunnel's invoices to the partner for separate contract fees (§11.3), from Stripe Billing.
create table partner_invoice (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partner (id),
  stripe_invoice_id text not null unique check (stripe_invoice_id ~ '^in_[A-Za-z0-9]+$'),
  number text check (char_length(number) <= 60),
  what text not null check (char_length(what) between 1 and 300),
  amount bigint not null check (amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null check (status in ('open', 'paid', 'void')),
  issued_at timestamptz(3) not null,
  due_at timestamptz(3),
  paid_at timestamptz(3)
);

create index partner_invoice_partner_idx on partner_invoice (partner_id, issued_at desc, id desc);

-- SAAS §7.2: the Stripe event id goes in first, so a replay is acknowledged and ignored.
create table billing_event (
  id text primary key check (id ~ '^evt_[A-Za-z0-9]+$'),
  type text not null check (char_length(type) <= 100),
  partner_id uuid references partner (id),
  store_id uuid references store (id),
  received_at timestamptz(3) not null default now(),
  handled_at timestamptz(3)
);

-- Stripe's ids make the webhook's writes upserts: a charge row is one subscription invoice (each
-- retry is a new Stripe charge on the same invoice) and a refund row one refund. A failed one
-- carries Billing's retry state.
alter table merchant_charge
  add column stripe_ref text unique check (stripe_ref ~ '^(in|re)_[A-Za-z0-9]+$'),
  add column retry_at timestamptz(3),
  add column attempt integer check (attempt between 1 and 20),
  add constraint merchant_charge_retry check (retry_at is null or (status = 'failed' and attempt is not null));

create index merchant_charge_retrying_idx on merchant_charge (partner_id, retry_at) where status = 'failed' and retry_at is not null;

alter table partner_payout
  add column stripe_payout_id text unique check (stripe_payout_id ~ '^po_[A-Za-z0-9]+$'),
  add column to_last4 text check (to_last4 ~ '^[0-9]{4}$'),
  add column failure_reason text check (char_length(failure_reason) <= 300),
  drop constraint partner_payout_status_check,
  add constraint partner_payout_status_check check (status in ('scheduled', 'paid', 'held', 'failed'));

grant select on partner_billing_account, partner_invoice to app_partner, app_platform;
-- A partner's own request records what Stripe answered about the token it sent; the webhook
-- (app_system) moves the statuses on.
grant insert (partner_id, stripe_account_id, stripe_customer_id, payout_bank, payout_last4, payout_status, payout_failure, card_brand, card_last4, card_expires, card_status, updated_at),
  update (stripe_account_id, stripe_customer_id, payout_bank, payout_last4, payout_status, payout_failure, card_brand, card_last4, card_expires, card_status, updated_at)
  on partner_billing_account to app_partner;
grant select, insert, update on partner_billing_account, partner_invoice, billing_event to app_system;
grant select on billing_event to app_platform;

do $$
declare
  t text;
begin
  foreach t in array array['partner_billing_account', 'partner_invoice', 'billing_event'] loop
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
    execute format('create policy %I on %I for select to app_platform using (true)', t || '_staff', t);
    execute format('create policy %I on %I for all to app_system using (true) with check (true)', t || '_system', t);
  end loop;
end
$$;

-- The partner reads and writes its own account and reads its own invoices; billing_event has no
-- partner branch.
create policy partner_billing_account_partner on partner_billing_account for all to app_partner
  using (partner_id = app_setting_uuid('app.partner_id')) with check (partner_id = app_setting_uuid('app.partner_id'));
create policy partner_invoice_partner_read on partner_invoice for select to app_partner
  using (partner_id = app_setting_uuid('app.partner_id'));
