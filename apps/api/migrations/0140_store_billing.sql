-- SAPI 19 (#329), part 1: the store's own billing (DATA-MODEL §7.9; SAAS §7.2): the Owner's details on DripFunnel's
-- invoices, those invoices with their lines as Stripe issued them, and a scheduled change's billing period.

-- A scheduled change may move the period too (yearly to monthly at the year's end); null keeps the one it has.
alter table store_subscription add column next_interval text check (next_interval in ('month', 'year'));
alter table store_subscription drop constraint store_subscription_next;
alter table store_subscription add constraint store_subscription_next check (
  (next_plan_id is null) = (next_plan_version is null) and (next_plan_id is null) = (change_at is null) and (next_interval is null or next_plan_id is not null)
);
grant select (next_interval) on store_subscription to app_partner, app_request;
-- One plan or card change at a time per store, taken before Stripe is asked and let go after, so two tabs or a retry
-- never charge twice; one left by a crash lapses at billing_claim_until.
alter table store_subscription add column billing_claim uuid, add column billing_claim_until timestamptz(3);

create table store_billing_details (
  store_id uuid primary key references store (id),
  legal_name text not null check (char_length(legal_name) between 1 and 200),
  address jsonb not null check (jsonb_typeof(address) = 'object'),
  email text not null check (char_length(email) between 3 and 254),
  tax_id text check (char_length(tax_id) between 4 and 20),
  tax_id_kind text check (tax_id_kind in ('gstin', 'vat')),
  updated_at timestamptz(3) not null default now(),
  constraint store_billing_details_tax check ((tax_id is null) = (tax_id_kind is null))
);

-- Written only by the webhook from the invoice Stripe holds; amounts in minor units of the invoice's currency.
create table invoice (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  stripe_invoice_id text not null unique,
  number text,
  kind text not null check (kind in ('subscription', 'proration', 'setup', 'usage', 'credit')),
  status text not null check (status in ('paid', 'open', 'void', 'refunded')),
  amount bigint not null check (amount >= 0),
  tax_amount bigint not null default 0 check (tax_amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  -- What the Owner had saved when Stripe issued it; issued invoices never change (SAAS §7.2).
  billing_details jsonb,
  issued_at timestamptz not null,
  paid_at timestamptz
);
create unique index invoice_id_store_key on invoice (id, store_id);
create index invoice_store_issued_idx on invoice (store_id, issued_at desc, id desc);

-- A plan change is one invoice with a charge line and a credit line, the credit below zero (SAAS §7.2).
create table invoice_line (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null,
  store_id uuid not null references store (id),
  position integer not null check (position >= 0),
  label text not null check (char_length(label) <= 300),
  amount bigint not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  kind text not null check (kind in ('plan', 'proration_charge', 'proration_credit', 'setup', 'usage')),
  period_start timestamptz,
  period_end timestamptz,
  unique (invoice_id, position),
  foreign key (invoice_id, store_id) references invoice (id, store_id) on delete cascade
);

-- The Owner's screen reads all three and writes its details; the webhook writes the invoices; staff read the
-- invoices, never the details (DATA-MODEL §7.9); a partner, a supplier and a storefront read none.
grant select, insert, update on store_billing_details to app_request;
grant select on invoice, invoice_line to app_request, app_platform;
grant select, insert, update, delete on store_billing_details, invoice, invoice_line to app_system;

do $$
declare
  t text;
begin
  foreach t in array array['store_billing_details', 'invoice', 'invoice_line'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %I on %I for all to app_system using (true) with check (true)', t || '_system', t);
    execute format('create policy %I on %I for all to app_request
      using (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'') and app_setting_text(''app.seller_id'') = '''')
      with check (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'') and app_setting_text(''app.seller_id'') = ''''
        and app_setting_text(''app.support'') <> ''read'')', t || '_merchant', t);
    execute format('create policy request_scope on %I as restrictive for all to app_request
      using (app_setting_text(''app.scope'') = ''store'') with check (app_setting_text(''app.scope'') = ''store'')', t);
    execute format('create policy partner_scope on %I as restrictive for all to app_partner using (false) with check (false)', t);
    execute format('create policy system_scope on %I as restrictive for all to app_system
      using (app_setting_text(''app.scope'') = ''system'') with check (app_setting_text(''app.scope'') = ''system'')', t);
  end loop;
  foreach t in array array['invoice', 'invoice_line'] loop
    execute format('create policy %I on %I for select to app_platform using (true)', t || '_staff', t);
    execute format('create policy platform_scope on %I as restrictive for all to app_platform
      using (app_setting_text(''app.scope'') = ''platform'') with check (app_setting_text(''app.scope'') = ''platform'')', t);
  end loop;
  execute 'create policy platform_scope on store_billing_details as restrictive for all to app_platform using (false) with check (false)';
end
$$;

-- Dunning finds past-due stores by age (SAAS §7.3).
create index store_past_due_idx on store (past_due_since) where status = 'past_due';
