-- The tenancy tree of DATA-MODEL.md §2, structure only: the business fields and states are
-- #32's, the identity pools #13's. `customer` is here because it is a node of the tree.

create table partner (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table store (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partner (id),
  created_at timestamptz not null default now()
);

-- §1: partner-level reads join through this.
create index store_partner_id_idx on store (partner_id);

create table seller (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  name text not null,
  -- The four levels §3.3 names.
  access_level text not null check (
    access_level in ('vendor-stock', 'vendor-catalogue', 'vendor-orders-read', 'vendor-orders-fulfil')
  ),
  -- No check: no document names the values.
  status text not null,
  created_at timestamptz not null default now()
);

create index seller_store_id_idx on seller (store_id);

create table customer (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  email text,
  email_verified_at timestamptz,
  phone text,
  phone_verified_at timestamptz,
  password_hash text,
  name text,
  -- ui/admin/FIRST-RELEASE.md §5.4 names these three.
  status text not null check (status in ('active', 'unverified', 'deleted')),
  created_at timestamptz not null default now(),
  -- §3.4: at least one identifier.
  constraint customer_email_or_phone check (email is not null or phone is not null)
);

-- Per store, never global (§2). Nulls repeat, which allows a phone-only customer.
create unique index customer_store_email_key on customer (store_id, email);
create unique index customer_store_phone_key on customer (store_id, phone);
