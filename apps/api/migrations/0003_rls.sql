-- The backstop behind `db/scoped` (DATA-MODEL.md §5). FORCE, so the owner is subject to it
-- too; the app connects as `app_request`, because a superuser bypasses RLS entirely.

-- Null when unset, so an unset setting makes every comparison below false: RLS fails closed.
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

-- §5.3. Cluster-wide, so guarded: a test run's database shares them with the dev one.
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

-- Per command: a `for all` policy with only USING reuses it as the WITH CHECK, making what a
-- caller may see what it may write. No DELETE policy anywhere, so deletes are refused for
-- everyone (FIRST-RELEASE §1).

-- Staff create partners (USERS-AND-DOMAINS §3), so only they may insert one.
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

-- A merchant reads its store row and never writes it (ACCESS §5.5).
-- Not suppliers (ACCESS §7): #32 puts the plan, code, owner and domains on this row.
create policy store_read on store for select
using (
  (
    app_setting_text('app.scope') in ('store', 'shop')
    and id = app_setting_uuid('app.store_id')
    and app_setting_text('app.seller_id') = ''
  )
  or (app_setting_text('app.scope') = 'partner' and partner_id = app_setting_uuid('app.partner_id'))
  or app_setting_text('app.scope') = 'platform'
);

-- A partner creates merchants under itself only (USERS-AND-DOMAINS §3).
create policy store_insert on store for insert
with check (
  (app_setting_text('app.scope') = 'partner' and partner_id = app_setting_uuid('app.partner_id'))
  or app_setting_text('app.scope') = 'platform'
);

-- The WITH CHECK stops a re-parent: moving a store between partners is SAAS §4.4's flow.
create policy store_update on store for update
using (
  (app_setting_text('app.scope') = 'partner' and partner_id = app_setting_uuid('app.partner_id'))
  or app_setting_text('app.scope') = 'platform'
)
with check (
  (app_setting_text('app.scope') = 'partner' and partner_id = app_setting_uuid('app.partner_id'))
  or app_setting_text('app.scope') = 'platform'
);

-- Inside the store, and a supplier reads only its own row (ACCESS §5.5). Store scope only,
-- not shop: nothing specifies that a storefront names a product's supplier.
create policy seller_read on seller for select
using (
  app_setting_text('app.scope') = 'store'
  and store_id = app_setting_uuid('app.store_id')
  and (app_setting_text('app.seller_id') = '' or id = app_setting_uuid('app.seller_id'))
);

-- Merchant side only: a supplier that could write this row could raise its own tier
-- (DATA-MODEL §1).
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

-- Inside the store, plus a read-only platform branch for the Customers menu, never a partner
-- one (§2). No suppliers (§5.2); a shopper reads only their own row.
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

-- Store scope only: the Customers menu is read-only (FIRST-RELEASE §5.4), and shopper signup
-- is #13's — a shop branch here would let an anonymous shopper insert.
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

-- A read-only support session must be refused every write (§5.2). Restrictive, so a table
-- added later cannot forget it, and per command because WITH CHECK does not cover DELETE.
do $$
declare
  t text;
begin
  foreach t in array array['partner', 'store', 'seller', 'customer'] loop
    execute format(
      'create policy support_no_insert on %I as restrictive for insert
         with check (app_setting_text(''app.support'') <> ''read'')', t);
    -- WITH CHECK, not USING: a USING would hide the row and make the update a silent no-op.
    execute format(
      'create policy support_no_update on %I as restrictive for update
         with check (app_setting_text(''app.support'') <> ''read'')', t);
    -- DELETE has no WITH CHECK, so this filters: no rows affected rather than an error.
    execute format(
      'create policy support_no_delete on %I as restrictive for delete
         using (app_setting_text(''app.support'') <> ''read'')', t);
  end loop;
end
$$;
