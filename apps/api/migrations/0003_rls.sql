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

-- Reads and writes get separate policies, per command.
--
-- A permissive policy written `for all` with only a USING clause reuses that clause as its
-- WITH CHECK, so "what you may see" silently becomes "what you may write". That let a store
-- caller re-parent its own store to another partner, let a supplier raise its own access
-- level, and let an anonymous shopper create customer rows. Reads and writes are different
-- questions and are answered separately below.
--
-- Writes are granted only where a document says who may make them, and denied otherwise:
-- a command with no permissive policy is refused. Nothing here deletes (FIRST-RELEASE §1,
-- "Nothing is deleted in this release"), so no table has a DELETE policy at all; the card
-- that needs one adds it with its rule and its test.

-- Partner (§5.2): its own partner's users, or the Admin API. Staff create partners
-- (USERS-AND-DOMAINS §3: "Admin creates the partner"), so only they may insert one.
create policy partner_read on partner for select
using (
  (app_setting_text('app.scope') = 'partner' and id = app_setting_uuid('app.partner_id'))
  or app_setting_text('app.scope') = 'platform'
);

create policy partner_insert on partner for insert
with check (app_setting_text('app.scope') = 'platform');

create policy partner_update on partner for update
using (
  (app_setting_text('app.scope') = 'partner' and id = app_setting_uuid('app.partner_id'))
  or app_setting_text('app.scope') = 'platform'
)
with check (
  (app_setting_text('app.scope') = 'partner' and id = app_setting_uuid('app.partner_id'))
  or app_setting_text('app.scope') = 'platform'
);

-- Store, account level (§2). A merchant reads its own store row and never writes it:
-- ACCESS §5.5 is explicit that subscription state, plan, partner and lifecycle fields are
-- "written only by the platform", and that the settings capability covers a merchant's own
-- settings "never the store record as a whole" — the UpdateChannel trap.
create policy store_read on store for select
using (
  (app_setting_text('app.scope') in ('store', 'shop') and id = app_setting_uuid('app.store_id'))
  or (app_setting_text('app.scope') = 'partner' and partner_id = app_setting_uuid('app.partner_id'))
  or app_setting_text('app.scope') = 'platform'
);

-- A partner creates merchants under itself (USERS-AND-DOMAINS §3), and cannot create one
-- under another partner: the WITH CHECK is on the new row's partner_id.
create policy store_insert on store for insert
with check (
  (app_setting_text('app.scope') = 'partner' and partner_id = app_setting_uuid('app.partner_id'))
  or app_setting_text('app.scope') = 'platform'
);

-- The WITH CHECK is what stops a store being re-parented: the row must still belong to the
-- caller's partner afterwards. Moving a store between partners is a guided, audited flow with
-- a second approver (SAAS §4.4), not an update.
create policy store_update on store for update
using (
  (app_setting_text('app.scope') = 'partner' and partner_id = app_setting_uuid('app.partner_id'))
  or app_setting_text('app.scope') = 'platform'
)
with check (
  (app_setting_text('app.scope') = 'partner' and partner_id = app_setting_uuid('app.partner_id'))
  or app_setting_text('app.scope') = 'platform'
);

-- Seller is inside the store: §2's scope table does not list it, but ACCESS §5.5 settles it —
-- "A vendor reads only its own vendor record, never the store's list of vendors". Store scope
-- only, not shop: nothing specifies that a storefront names a product's supplier, and §5.2
-- says shop reads return "only what the Shop API may show". §2 is corrected in this change.
create policy seller_read on seller for select
using (
  app_setting_text('app.scope') = 'store'
  and store_id = app_setting_uuid('app.store_id')
  and (app_setting_text('app.seller_id') = '' or id = app_setting_uuid('app.seller_id'))
);

-- The merchant side only. "The merchant decides what the supplier may do, not who works
-- there" (DATA-MODEL §1): a supplier that could write this row could raise its own
-- access_level, which is the whole boundary.
create policy seller_insert on seller for insert
with check (
  app_setting_text('app.scope') = 'store'
  and store_id = app_setting_uuid('app.store_id')
  and app_setting_text('app.seller_id') = ''
);

create policy seller_update on seller for update
using (
  app_setting_text('app.scope') = 'store'
  and store_id = app_setting_uuid('app.store_id')
  and app_setting_text('app.seller_id') = ''
)
with check (
  app_setting_text('app.scope') = 'store'
  and store_id = app_setting_uuid('app.store_id')
  and app_setting_text('app.seller_id') = ''
);

-- Customer (§2): as inside the store, plus a read-only platform branch for the admin
-- console's Customers menu, and never a partner branch. A supplier never reads customers
-- (§5.2). A shopper reads only their own row.
create policy customer_read on customer for select
using (
  (
    app_setting_text('app.scope') in ('store', 'shop')
    and store_id = app_setting_uuid('app.store_id')
    and app_setting_text('app.seller_id') = ''
    and (app_setting_text('app.scope') = 'store' or id = app_setting_uuid('app.customer_id'))
  )
  or app_setting_text('app.scope') = 'platform'
);

-- Store scope only. No platform branch, because the Customers menu is read-only
-- (FIRST-RELEASE §5.4, "No actions in this release"). No shop branch either: shopper signup
-- and profile edits are #13's, and a shop-scope write policy here would let an anonymous
-- shopper create customer rows in any store it can reach. #13 adds the branch it needs.
create policy customer_insert on customer for insert
with check (
  app_setting_text('app.scope') = 'store'
  and store_id = app_setting_uuid('app.store_id')
  and app_setting_text('app.seller_id') = ''
);

create policy customer_update on customer for update
using (
  app_setting_text('app.scope') = 'store'
  and store_id = app_setting_uuid('app.store_id')
  and app_setting_text('app.seller_id') = ''
)
with check (
  app_setting_text('app.scope') = 'store'
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
