-- Row-level security as the backstop (DATA-MODEL.md §5, decided 2026-09-28): `db/scoped`
-- applies scope in every query, and these policies refuse whatever it misses.
--
-- Two things make this real rather than decorative:
--   * FORCE ROW LEVEL SECURITY, so the table owner is subject to its own policies;
--   * the application connects as `app_request`, which is NOT a superuser. A superuser
--     bypasses RLS altogether, so a test that connects as one proves nothing.

-- §5.1: the per-transaction settings, read from the caller's context by db/ and never from
-- request input. The two-argument form returns null when unset instead of raising, and an
-- unset setting must make a policy refuse rather than error — so every comparison below is
-- against null, which is never equal to anything. RLS fails closed.
create function app_setting_uuid(setting text) returns uuid
language sql
stable
parallel safe
as $$ select nullif(current_setting(setting, true), '')::uuid $$;

create function app_setting_text(setting text) returns text
language sql
stable
parallel safe
as $$ select coalesce(current_setting(setting, true), '') $$;

-- §5.3. Roles are cluster-wide, so creating them is guarded: several databases in one
-- cluster (a test run's throwaway database beside the development one) share them.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_request') then
    create role app_request nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_system') then
    create role app_system nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_migrate') then
    create role app_migrate nologin;
  end if;
end
$$;

grant usage on schema public to app_request, app_system;
grant select, insert, update, delete on partner, store, seller, customer to app_request, app_system;

alter table partner enable row level security;
alter table store enable row level security;
alter table seller enable row level security;
alter table customer enable row level security;

alter table partner force row level security;
alter table store force row level security;
alter table seller force row level security;
alter table customer force row level security;

-- Partner scope (§5.2): its own partner's users, or the Admin API.
create policy partner_scope on partner
using (
  (app_setting_text('app.scope') = 'partner' and id = app_setting_uuid('app.partner_id'))
  or app_setting_text('app.scope') = 'platform'
);

-- Store, account level (§2): the store's people, its partner's users, the Admin API. This is
-- the level a partner may reach — plan, status, domains — and no further.
create policy store_scope on store
using (
  (app_setting_text('app.scope') in ('store', 'shop') and id = app_setting_uuid('app.store_id'))
  or (app_setting_text('app.scope') = 'partner' and partner_id = app_setting_uuid('app.partner_id'))
  or app_setting_text('app.scope') = 'platform'
);

-- Seller is inside the store: §2's scope table does not list it, but ACCESS §5.5 settles it —
-- "A vendor reads only its own vendor record, never the store's list of vendors" — and §5.2's
-- supplier rule gives the shape. No partner or platform branch: a supplier is a merchant's
-- business, and staff reach it only by impersonating (USERS-AND-DOMAINS §4). §2 is corrected
-- in this change to name it.
-- Store scope only, not shop: nothing specifies that a storefront shows who supplies a
-- product, and §5.2 says shop reads return "only what the Shop API may show". Least
-- privilege until a commerce module needs otherwise.
create policy seller_scope on seller
using (
  app_setting_text('app.scope') = 'store'
  and store_id = app_setting_uuid('app.store_id')
  and (
    -- The merchant side sees every supplier; a supplier sees only itself.
    app_setting_text('app.seller_id') = ''
    or id = app_setting_uuid('app.seller_id')
  )
);

-- Customer (§2): as inside the store, plus a read-only platform branch for the admin
-- console's Customers menu, and never a partner branch. A supplier never reads customers
-- (§5.2). A shopper reads only their own row.
create policy customer_scope on customer
for select
using (
  (
    app_setting_text('app.scope') in ('store', 'shop')
    and store_id = app_setting_uuid('app.store_id')
    and app_setting_text('app.seller_id') = ''
    and (
      app_setting_text('app.scope') = 'store'
      or id = app_setting_uuid('app.customer_id')
    )
  )
  or app_setting_text('app.scope') = 'platform'
);

-- Writes get no platform branch at all: the Customers menu is read-only (§2, FIRST-RELEASE
-- §5.4 "No actions in this release"), so staff cannot change a shopper's row even by mistake.
create policy customer_write on customer
for all
using (
  app_setting_text('app.scope') in ('store', 'shop')
  and store_id = app_setting_uuid('app.store_id')
  and app_setting_text('app.seller_id') = ''
  and (
    app_setting_text('app.scope') = 'store'
    or id = app_setting_uuid('app.customer_id')
  )
)
with check (
  app_setting_text('app.scope') in ('store', 'shop')
  and store_id = app_setting_uuid('app.store_id')
  and app_setting_text('app.seller_id') = ''
);

-- §5.2: a support session runs in store scope with app.support = 'read', and every write
-- must refuse it. Restrictive, so it is AND-ed with the policies above and cannot be
-- forgotten by a table added later.
--
-- Per command, deliberately. DATA-MODEL §5.2 says the read-only session is refused by "write
-- policies (WITH CHECK)", but WITH CHECK does not apply to DELETE — a single FOR ALL policy
-- with `using (true)` refuses updates and inserts while letting a read-only session delete
-- the row outright. DELETE is governed by USING, so it needs its own. §5.2 is corrected in
-- this change.
do $$
declare
  t text;
begin
  foreach t in array array['partner', 'store', 'seller', 'customer'] loop
    execute format(
      'create policy support_no_insert on %I as restrictive for insert
         with check (app_setting_text(''app.support'') <> ''read'')', t);
    -- WITH CHECK only, no USING: a restrictive USING would hide the row and make the update
    -- a silent no-op, where WITH CHECK raises. Both are safe; one says why.
    execute format(
      'create policy support_no_update on %I as restrictive for update
         with check (app_setting_text(''app.support'') <> ''read'')', t);
    -- DELETE has no WITH CHECK in Postgres, so this can only filter: the delete affects no
    -- rows rather than raising. Silent, but the row survives, which is the point.
    execute format(
      'create policy support_no_delete on %I as restrictive for delete
         using (app_setting_text(''app.support'') <> ''read'')', t);
  end loop;
end
$$;
