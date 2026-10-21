-- SAPI 14 (#320), part 1: offers (DATA-MODEL §7.7; OFFERS-DESIGN §3). The merchant's alone: no supplier branch and no shop
-- branch, so the engine prices a cart's offers in system scope and a shopper never reads an offer's rules or codes.

create table promotion (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  -- Shown to shoppers and snapshotted on the order's discount line (OFFERS fact 13), so it fits order_adjustment.label.
  name text not null check (char_length(name) between 1 and 120),
  internal_name text check (char_length(internal_name) between 1 and 120),
  description text check (char_length(description) <= 500),
  -- How shoppers get it (C2); a code offer applies only through one of its codes, however many it has yet.
  trigger text not null check (trigger in ('automatic', 'code')),
  enabled boolean not null default false,
  starts_at timestamptz(3),
  ends_at timestamptz(3),
  total_uses_limit integer check (total_uses_limit between 1 and 100000000),
  per_customer_limit integer check (per_customer_limit between 1 and 1000),
  -- Counted at placement with promotion_usage, never written by a request role (fact 8).
  uses_count integer not null default 0 check (uses_count >= 0),
  -- Fact 7's flags; a new offer combines with nothing (#337).
  combines_with jsonb not null default '{"product": false, "order": false, "shipping": false}',
  created_by_user_id uuid references "user" (id) on delete set null,
  created_at timestamptz(3) not null default now(),
  updated_at timestamptz(3) not null default now(),
  revision integer not null default 1,
  deleted_at timestamptz(3),
  check (starts_at is null or ends_at is null or ends_at > starts_at)
);
create unique index promotion_id_store_key on promotion (id, store_id);
create index promotion_list_idx on promotion (store_id, created_at desc, id desc) where deleted_at is null;

create table promotion_condition (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null,
  store_id uuid not null,
  operation text not null check (operation in ('minimum_order_amount', 'minimum_quantity', 'contains_products', 'at_least_n_with_filter_values',
    'contains_collection', 'customer_group', 'specific_customers', 'first_order', 'shipping_country', 'recurrence', 'any_of')),
  args jsonb not null default '{}',
  position integer not null check (position between 0 and 19),
  unique (promotion_id, position),
  foreign key (promotion_id, store_id) references promotion (id, store_id)
);

create table promotion_action (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null,
  store_id uuid not null,
  operation text not null check (operation in ('order_percentage_discount', 'order_fixed_discount', 'products_percentage_discount', 'line_fixed_discount',
    'free_shipping', 'shipping_fixed_discount', 'buy_x_get_y', 'tiered_discount')),
  args jsonb not null default '{}',
  position integer not null check (position between 0 and 4),
  unique (promotion_id, position),
  foreign key (promotion_id, store_id) references promotion (id, store_id)
);

create table promotion_code_batch (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null,
  store_id uuid not null,
  prefix text not null default '' check (prefix ~ '^[A-Z0-9_-]{0,12}$'),
  length integer not null check (length between 6 and 16),
  count integer not null check (count between 1 and 5000),
  created_at timestamptz(3) not null default now(),
  foreign key (promotion_id, store_id) references promotion (id, store_id)
);
create unique index promotion_code_batch_id_store_key on promotion_code_batch (id, store_id);

create table promotion_code (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null,
  store_id uuid not null,
  batch_id uuid,
  -- Saved uppercase (OFFERS fact 6); matched case-insensitively through the index below.
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'),
  single_use boolean not null default false,
  expires_at timestamptz(3),
  used_at timestamptz(3),
  -- A shared code changed on a live offer stops working and stays this offer's (H5).
  replaced_at timestamptz(3),
  created_at timestamptz(3) not null default now(),
  foreign key (promotion_id, store_id) references promotion (id, store_id),
  foreign key (batch_id, store_id) references promotion_code_batch (id, store_id),
  check (not single_use or batch_id is not null)
);
-- Unique per store including spent, replaced and deleted offers' codes (fact 14, #188).
create unique index promotion_code_store_code_key on promotion_code (store_id, lower(code));
create unique index promotion_code_id_store_key on promotion_code (id, store_id);
create index promotion_code_promotion_idx on promotion_code (promotion_id, batch_id);

create table promotion_usage (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null,
  promotion_code_id uuid,
  store_id uuid not null,
  order_id uuid not null,
  customer_id uuid,
  -- Normalised (lower-case, trimmed): how a guest is recognised (fact 8, #337).
  customer_email text check (customer_email = lower(btrim(customer_email))),
  discount_amount bigint not null check (discount_amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz(3) not null default now(),
  unique (promotion_id, order_id),
  -- Every end in the usage row's own store, whatever scope wrote it (placement runs in system scope).
  foreign key (promotion_id, store_id) references promotion (id, store_id),
  foreign key (promotion_code_id, store_id) references promotion_code (id, store_id),
  foreign key (customer_id, store_id) references customer (id, store_id),
  foreign key (order_id, store_id) references "order" (id, store_id)
);
create index promotion_usage_customer_idx on promotion_usage (promotion_id, customer_id) where customer_id is not null;
create index promotion_usage_email_idx on promotion_usage (promotion_id, customer_email) where customer_email is not null;
create index promotion_usage_order_idx on promotion_usage (order_id);

-- The merchant side writes offers and their codes by column; uses are counted only by the engine at placement (system).
grant select, insert, update, delete on promotion, promotion_condition, promotion_action, promotion_code_batch, promotion_code, promotion_usage to app_system;
grant select on promotion, promotion_condition, promotion_action, promotion_code_batch, promotion_code, promotion_usage to app_request;
grant insert (store_id, name, internal_name, description, trigger, enabled, starts_at, ends_at, total_uses_limit, per_customer_limit, combines_with, created_by_user_id)
  on promotion to app_request;
grant update (name, internal_name, description, trigger, enabled, starts_at, ends_at, total_uses_limit, per_customer_limit, combines_with, updated_at, revision, deleted_at)
  on promotion to app_request;
grant insert, delete on promotion_condition, promotion_action to app_request;
grant insert (promotion_id, store_id, prefix, length, count) on promotion_code_batch to app_request;
grant insert (promotion_id, store_id, batch_id, code, single_use, expires_at) on promotion_code to app_request;
grant update (replaced_at) on promotion_code to app_request;

do $$
declare
  t text;
begin
  foreach t in array array['promotion', 'promotion_condition', 'promotion_action', 'promotion_code_batch', 'promotion_code', 'promotion_usage'] loop
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
    execute format('create policy platform_scope on %I as restrictive for all to app_platform using (false) with check (false)', t);
    execute format('create policy system_scope on %I as restrictive for all to app_system
      using (app_setting_text(''app.scope'') = ''system'') with check (app_setting_text(''app.scope'') = ''system'')', t);
  end loop;
end
$$;

-- The pricing page's "3 live" (SAAS §6.1): a limit, beside the offers switch. Plan versions written before it keep
-- every offer they could make, as nothing counted them; a partner sets the number from its next edit.
insert into plan_key (key, kind) values ('live_offers', 'amount');
insert into plan_entitlement (plan_id, partner_id, version, key, enabled, amount)
select v.plan_id, v.partner_id, v.version, 'live_offers', null, 2147483647 from plan_version v
on conflict do nothing;
