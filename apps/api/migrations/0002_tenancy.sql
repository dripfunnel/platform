-- The tenancy tree of DATA-MODEL.md §2: partner → store → seller and customer.
--
-- Structure only. The business fields and states the admin console reads — partner states,
-- the house flag, portal host, store code, plan, storefront kind, domains — belong to #32,
-- which says so itself: "#12 built the tenancy tree. This gives partners and stores the
-- fields and states the admin console reads."
--
-- Identity pools (§3.1, §3.2, §3.3's user and membership, §3.5) belong to #13. `customer` is
-- here because it is a node of the tree; its sessions and per-store auth settings are #13's.

create table partner (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table store (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partner (id),
  created_at timestamptz not null default now()
);

-- Every partner-level read of stores joins through this (§1: "Partner-level reads join
-- through `store`, one indexed join").
create index store_partner_id_idx on store (partner_id);

create table seller (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  name text not null,
  -- The four levels §3.3 names. The merchant sets this; it is not the supplier's to change.
  access_level text not null check (
    access_level in ('vendor-stock', 'vendor-catalogue', 'vendor-orders-read', 'vendor-orders-fulfil')
  ),
  -- No check: no document names the values (ACCESS §7.5 describes suspend and remove as
  -- behaviour without naming states). Left open rather than invented.
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

-- §2: "Unique constraints are per scope … customer email and phone per store. Never global."
-- Nulls repeat freely, which is what allows a phone-only or email-only customer.
create unique index customer_store_email_key on customer (store_id, email);
create unique index customer_store_phone_key on customer (store_id, phone);
