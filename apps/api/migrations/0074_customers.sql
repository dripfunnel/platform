-- SAPI 13 (#312), part 1: the store's customers (DATA-MODEL §7.5; FIRST-RELEASE §7): tags, a team note, marketing
-- consent, groups, and a row for every live guest buyer, so the list holds everyone who has bought or been added.

alter table customer
  add column tags text[] not null default '{}' check (cardinality(tags) <= 20),
  add column note text check (char_length(note) <= 2000),
  add column consent_state text not null default 'not_asked' check (consent_state in ('opted_in', 'stopped', 'declined', 'not_asked')),
  add column consent_at timestamptz(3),
  add column consent_source text check (consent_source in ('checkout', 'email', 'added_by_hand', 'recorded_by_store')),
  add column consent_channels text[] not null default '{}' check (consent_channels <@ array['email', 'sms', 'whatsapp']),
  add column added_by_user_id uuid references "user" (id) on delete set null;
create unique index customer_id_store_key on customer (id, store_id);

create table customer_group (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  name text not null check (char_length(name) between 1 and 60),
  description text check (char_length(description) <= 200),
  created_at timestamptz(3) not null default now(),
  deleted_at timestamptz(3)
);
create unique index customer_group_id_store_key on customer_group (id, store_id);
create unique index customer_group_name_key on customer_group (store_id, lower(name)) where deleted_at is null;

create table customer_group_member (
  group_id uuid not null,
  customer_id uuid not null,
  store_id uuid not null references store (id),
  added_at timestamptz(3) not null default now(),
  primary key (group_id, customer_id),
  -- Both ends in the member's own store, whatever the caller's policies let it see.
  foreign key (group_id, store_id) references customer_group (id, store_id),
  foreign key (customer_id, store_id) references customer (id, store_id)
);
create index customer_group_member_customer_idx on customer_group_member (customer_id);

-- A guest's orders are found by the email or number they were placed with (customer_id stays null, ACCESS §2.1).
create index order_guest_email_idx on "order" (store_id, email) where customer_id is null and state <> 'cart';
create index order_guest_phone_idx on "order" (store_id, phone) where customer_id is null and state <> 'cart';

-- Guests who bought before this migration, once each, as checkout now adds them: unverified, no password.
insert into customer (store_id, email, phone, name, status, created_at)
select distinct on (o.store_id, coalesce(o.email, o.phone)) o.store_id, o.email, case when o.email is null then o.phone end, o.shipping_address ->> 'name', 'unverified', o.placed_at
from "order" o
where o.state <> 'cart' and o.customer_id is null and coalesce(o.email, o.phone) is not null
  and not exists (select 1 from payment m where m.order_id = o.id and m.mode = 'test')
  and not exists (select 1 from customer c where c.store_id = o.store_id and (c.email = o.email or (o.email is null and c.phone = o.phone)))
order by o.store_id, coalesce(o.email, o.phone), o.placed_at
on conflict do nothing;

-- The merchant side keeps its customers' groups and default addresses; a supplier and a shopper never see a group.
grant select, insert, update on customer_group to app_request, app_system;
grant select, insert, delete on customer_group_member to app_request, app_system;
grant insert (customer_id, store_id, name, line1, line2, city, region, postal_code, country, phone, is_default_shipping) on customer_address to app_request;
grant update (name, line1, line2, city, region, postal_code, country, phone, is_default_shipping) on customer_address to app_request;

do $$
declare
  t text;
begin
  foreach t in array array['customer_group', 'customer_group_member'] loop
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

create policy customer_address_merchant_write on customer_address for insert to app_request
with check (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '' and app_setting_text('app.support') <> 'read');
create policy customer_address_merchant_update on customer_address for update to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '')
with check (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '' and app_setting_text('app.support') <> 'read');

-- The customers export is a store export like the others (0058, 0073), never a supplier's.
alter table catalog_export drop constraint catalog_export_kind_check;
alter table catalog_export add constraint catalog_export_kind_check check (kind in ('products', 'stock', 'orders', 'customers'));
