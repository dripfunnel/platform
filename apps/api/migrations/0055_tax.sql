-- SAPI 7 (#297): tax classes, zones and rates (DATA-MODEL §7.2; CATALOG facts 37–38, T3–T4; SetOps Tax setup).
-- A version carries a class; the rate is class × the shopper's zone, from the store's own rates (India's GST,
-- and a US store's state rates when it has no Stripe); with Stripe connected, Stripe Tax computes US tax from
-- each class's product tax code, on the merchant's own account (decided on #284, #337).

create table tax_class (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  name text not null check (char_length(name) between 1 and 60),
  -- Stripe's product tax code, for US checkouts through Stripe Tax (CATALOG fact 37).
  tax_code text check (tax_code ~ '^txcd_[0-9]{8}$'),
  is_default boolean not null default false,
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index tax_class_id_store_key on tax_class (id, store_id);
create unique index tax_class_name_key on tax_class (store_id, lower(name)) where deleted_at is null;
create unique index tax_class_default_key on tax_class (store_id) where is_default and deleted_at is null;

-- Where a rate applies: countries, and within them regions (a US state's code, or an Indian state's name); no
-- regions is the whole of each country.
create table tax_zone (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  name text not null check (char_length(name) between 1 and 60),
  countries jsonb not null check (jsonb_typeof(countries) = 'array' and jsonb_array_length(countries) > 0),
  regions jsonb not null default '[]' check (jsonb_typeof(regions) = 'array'),
  created_at timestamptz not null default now()
);
create unique index tax_zone_id_store_key on tax_zone (id, store_id);
create unique index tax_zone_name_key on tax_zone (store_id, lower(name));

create table tax_rate (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  tax_class_id uuid not null,
  tax_zone_id uuid not null,
  rate_bps integer not null check (rate_bps between 0 and 10000),
  valid_from date not null default '2000-01-01',
  foreign key (tax_class_id, store_id) references tax_class (id, store_id),
  foreign key (tax_zone_id, store_id) references tax_zone (id, store_id) on delete cascade
);
create unique index tax_rate_key on tax_rate (tax_class_id, tax_zone_id, valid_from);

-- A version's class, the store's default when none (fact 38: a product can differ from it).
alter table product_version add column tax_class_id uuid;
alter table product_version add constraint product_version_tax_class foreign key (tax_class_id, store_id) references tax_class (id, store_id);

-- Every store starts with classes for its country, as the prototype's Tax setup does: India's GST slabs at its
-- rates, the US's two Stripe codes (Stripe Tax works the rates out), elsewhere a standard and an exempt class.
create function store_default_tax() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  zone uuid;
  class uuid;
  slab record;
begin
  if new.country = 'IN' then
    insert into tax_zone (store_id, name, countries) values (new.id, 'India', '["IN"]') returning id into zone;
    for slab in select * from (values ('Standard', 1800, true, 0), ('Clothing', 500, false, 1), ('Essentials', 500, false, 2), ('Exempt', 0, false, 3)) as s(name, bps, is_default, position) loop
      insert into tax_class (store_id, name, is_default, position) values (new.id, slab.name, slab.is_default, slab.position) returning id into class;
      insert into tax_rate (store_id, tax_class_id, tax_zone_id, rate_bps) values (new.id, class, zone, slab.bps);
    end loop;
  elsif new.country = 'US' then
    insert into tax_class (store_id, name, tax_code, is_default, position) values
      (new.id, 'General goods', 'txcd_99999999', true, 0), (new.id, 'Not taxed', 'txcd_00000000', false, 1);
  else
    insert into tax_class (store_id, name, is_default, position) values (new.id, 'Standard', true, 0), (new.id, 'Exempt', false, 1);
  end if;
  return new;
end
$$;
grant insert on tax_zone, tax_class, tax_rate to app_definer;
-- The ids it inserts it reads back, to give each class its rate.
grant select (id) on tax_zone, tax_class to app_definer;
alter function store_default_tax() owner to app_definer;
create trigger store_default_tax after insert on store for each row execute function store_default_tax();

-- Stores that already exist get the same, as their default warehouse and market did.
do $$
declare
  s record;
  zone uuid;
  class uuid;
  slab record;
begin
  for s in select id, country from store loop
    if s.country = 'IN' then
      insert into tax_zone (store_id, name, countries) values (s.id, 'India', '["IN"]') returning id into zone;
      for slab in select * from (values ('Standard', 1800, true, 0), ('Clothing', 500, false, 1), ('Essentials', 500, false, 2), ('Exempt', 0, false, 3)) as v(name, bps, is_default, position) loop
        insert into tax_class (store_id, name, is_default, position) values (s.id, slab.name, slab.is_default, slab.position) returning id into class;
        insert into tax_rate (store_id, tax_class_id, tax_zone_id, rate_bps) values (s.id, class, zone, slab.bps);
      end loop;
    elsif s.country = 'US' then
      insert into tax_class (store_id, name, tax_code, is_default, position) values (s.id, 'General goods', 'txcd_99999999', true, 0), (s.id, 'Not taxed', 'txcd_00000000', false, 1);
    else
      insert into tax_class (store_id, name, is_default, position) values (s.id, 'Standard', true, 0), (s.id, 'Exempt', false, 1);
    end if;
  end loop;
end
$$;

grant select, insert, update on tax_class, tax_zone, tax_rate to app_request;
grant delete on tax_zone, tax_rate to app_request;
grant select, insert, update, delete on tax_class, tax_zone, tax_rate to app_system;
grant update (tax_class_id) on product_version to app_request;

do $$
declare
  t text;
begin
  foreach t in array array['tax_class', 'tax_zone', 'tax_rate'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %I on %I for all to app_system using (true) with check (true)', t || '_system', t);
    execute format('create policy %I on %I for all to app_request
      using (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'') and app_setting_text(''app.seller_id'') = '''')
      with check (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'') and app_setting_text(''app.seller_id'') = '''')', t || '_merchant', t);
    execute format('create policy request_scope on %I as restrictive for all to app_request
      using (app_setting_text(''app.scope'') in (''store'', ''shop'', ''partner'', ''platform''))
      with check (app_setting_text(''app.scope'') in (''store'', ''shop'', ''partner'', ''platform''))', t);
    execute format('create policy partner_scope on %I as restrictive for all to app_partner using (false) with check (false)', t);
    execute format('create policy platform_scope on %I as restrictive for all to app_platform using (false) with check (false)', t);
    execute format('create policy system_scope on %I as restrictive for all to app_system
      using (app_setting_text(''app.scope'') = ''system'') with check (app_setting_text(''app.scope'') = ''system'')', t);
    execute format('create policy support_no_insert on %I as restrictive for insert to app_request with check (app_setting_text(''app.support'') <> ''read'')', t);
    execute format('create policy support_no_update on %I as restrictive for update to app_request with check (app_setting_text(''app.support'') <> ''read'')', t);
    execute format('create policy support_no_delete on %I as restrictive for delete to app_request using (app_setting_text(''app.support'') <> ''read'')', t);
  end loop;
end
$$;
