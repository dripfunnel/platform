-- SAPI 11 (#310), part 3: returns, refunds per owner, money given back at the provider, and the supplier ledger
-- (DATA-MODEL §7.6, §7.11; ACCESS §7.3). Written by the engine in system scope, as the order's totals and stock are.

create table "return" (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  order_id uuid not null,
  -- 'R' + the order's number + '-' + n.
  number text not null check (char_length(number) between 1 and 60),
  state text not null default 'requested' check (state in ('requested', 'received', 'refunded', 'cancelled')),
  reason text not null check (reason in ('doesnt_fit', 'changed_mind', 'damaged', 'wrong_item', 'not_as_described')),
  -- The store's own words, which may name the shopper: never a supplier's to read.
  note text check (char_length(note) <= 1000),
  label_sent_at timestamptz,
  received_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (store_id, number),
  unique (id, store_id),
  foreign key (order_id, store_id) references "order" (id, store_id)
);
create index return_order_idx on "return" (order_id, created_at);

create table return_line (
  return_id uuid not null references "return" (id),
  order_line_id uuid not null references order_line (id),
  store_id uuid not null,
  seller_id uuid,
  quantity integer not null check (quantity between 1 and 999),
  -- The line owner's by its part's mode: the store's default for its own and to-store lines, the supplier's for to-shopper.
  destination_warehouse_id uuid not null,
  primary key (return_id, order_line_id),
  foreign key (destination_warehouse_id, store_id) references warehouse (id, store_id)
);
create index return_line_seller_idx on return_line (store_id, seller_id, return_id) where seller_id is not null;

create table refund (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  -- One owner a refund: its lines are all this owner's (null, the merchant's).
  seller_id uuid,
  order_id uuid not null,
  return_id uuid references "return" (id),
  amount bigint not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  reason text not null check (reason in ('returned', 'goodwill', 'cancelled', 'other')),
  note text check (char_length(note) <= 1000),
  restock boolean not null default false,
  -- Set when the store refunded a supplier's lines itself; the ledger records it against the supplier (ACCESS §7.3).
  override_of_seller_id uuid,
  by_user_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (order_id, store_id) references "order" (id, store_id),
  foreign key (seller_id, store_id) references seller (id, store_id),
  check (override_of_seller_id is null or override_of_seller_id = seller_id)
);
create index refund_order_idx on refund (order_id, created_at);
create index refund_seller_idx on refund (store_id, seller_id) where seller_id is not null;

create table refund_line (
  refund_id uuid not null references refund (id),
  order_line_id uuid not null references order_line (id),
  store_id uuid not null,
  seller_id uuid,
  quantity integer not null check (quantity between 0 and 999),
  amount bigint not null check (amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  primary key (refund_id, order_line_id)
);
create index refund_line_order_line_idx on refund_line (order_line_id);

-- The money at the provider: a card's refund there, or a cash or transfer one the store gave back itself.
create table payment_refund (
  id uuid primary key default gen_random_uuid(),
  refund_id uuid not null references refund (id),
  payment_id uuid not null references payment (id),
  store_id uuid not null,
  provider_ref text check (char_length(provider_ref) <= 255),
  state text not null check (state in ('pending', 'done', 'failed')),
  amount bigint not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payment_refund_refund_idx on payment_refund (refund_id);

-- What a supplier owes the store, or is owed, settled outside the platform (PLATFORM-PROMPT §5.4).
create table supplier_ledger_entry (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  seller_id uuid not null,
  -- Positive: the supplier owes the store (the store refunded the supplier's lines for it).
  amount bigint not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  kind text not null check (kind in ('refund_override', 'adjustment')),
  refund_id uuid references refund (id),
  note text check (char_length(note) <= 1000),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  foreign key (seller_id, store_id) references seller (id, store_id)
);
create index supplier_ledger_entry_seller_idx on supplier_ledger_entry (store_id, seller_id, created_at);

-- Never more given back than was bought or paid for a line, whoever writes it: the ceiling is the database's (§7.6).
create function refund_line_ceiling() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  line record;
  refunded_quantity integer;
  refunded_amount bigint;
begin
  select quantity, line_total_amount into line from order_line where id = new.order_line_id;
  select coalesce(sum(quantity), 0), coalesce(sum(amount), 0) into refunded_quantity, refunded_amount from refund_line where order_line_id = new.order_line_id;
  if refunded_quantity > line.quantity or refunded_amount > line.line_total_amount then
    raise exception 'refund past the line' using errcode = 'check_violation', constraint = 'refund_line_ceiling';
  end if;
  return null;
end
$$;
create constraint trigger refund_line_ceiling after insert on refund_line for each row execute function refund_line_ceiling();
alter table "order" add constraint order_refunded_within_total check (refunded_amount <= coalesce(total_amount, 0) or state = 'cart');

grant select, insert, update on "return", return_line, refund, refund_line, payment_refund, supplier_ledger_entry to app_system;
grant select on "return", return_line, refund, refund_line, payment_refund, supplier_ledger_entry to app_request;
grant select on return_line, refund_line to app_supplier;
grant select (id, store_id, seller_id, order_id, return_id, amount, currency, reason, restock, override_of_seller_id, created_at) on refund to app_supplier;
grant select (id, store_id, seller_id, amount, currency, kind, refund_id, created_at) on supplier_ledger_entry to app_supplier;

do $$
declare
  t text;
begin
  foreach t in array array['return', 'return_line', 'refund', 'refund_line', 'payment_refund', 'supplier_ledger_entry'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %I on %I for all to app_system using (true) with check (true)', t || '_system', t);
    execute format('create policy %I on %I for select to app_request
      using (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'') and app_setting_text(''app.seller_id'') = '''')', t || '_merchant', t);
    execute format('create policy request_scope on %I as restrictive for all to app_request, app_supplier
      using (app_setting_text(''app.scope'') = ''store'') with check (app_setting_text(''app.scope'') = ''store'')', t);
    execute format('create policy partner_scope on %I as restrictive for all to app_partner using (false) with check (false)', t);
    execute format('create policy platform_scope on %I as restrictive for all to app_platform using (false) with check (false)', t);
    execute format('create policy system_scope on %I as restrictive for all to app_system
      using (app_setting_text(''app.scope'') = ''system'') with check (app_setting_text(''app.scope'') = ''system'')', t);
  end loop;
  foreach t in array array['return_line', 'refund', 'refund_line', 'supplier_ledger_entry'] loop
    execute format('create policy %I on %I for select to app_supplier
      using (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'') and seller_id = app_setting_uuid(''app.seller_id''))', t || '_supplier', t);
  end loop;
end
$$;

-- A return holding a supplier's lines, without the store's note (§7.11).
create view return_for_supplier with (security_barrier) as
  select r.id, r.store_id, r.order_id, r.number, r.state, r.reason, r.label_sent_at, r.received_at, r.cancelled_at, r.created_at
  from "return" r
  where app_setting_text('app.scope') = 'store' and app_setting_text('app.seller_id') <> '' and r.store_id = app_setting_uuid('app.store_id')
    and exists (select 1 from return_line l where l.return_id = r.id and l.seller_id = app_setting_uuid('app.seller_id'));
grant select (id, store_id, order_id, number, state, reason, label_sent_at, received_at, cancelled_at, created_at) on "return" to app_definer;
grant select (return_id, seller_id) on return_line to app_definer;
alter view return_for_supplier owner to app_definer;
grant select on return_for_supplier to app_supplier;
