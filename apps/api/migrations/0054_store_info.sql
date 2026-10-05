-- SAPI 6 (#296), part 4: Settings › Store info (SetStore; DATA-MODEL §7.2): the store's description, logo,
-- address, contact, time zone, units and order-number format on the store row; its legal name in
-- invoice_settings and its tax id in tax_registration, one home each. The merchant side writes the store
-- row through save_store_info() alone, its update grant being the partner's and staff's.

alter table store
  add column description text not null default '' check (char_length(description) <= 120),
  add column logo_asset_id uuid,
  -- street, city, postal and region, in any country's format (CATALOG fact 36).
  add column address jsonb not null default '{}' check (jsonb_typeof(address) = 'object'),
  add column contact_email text check (char_length(contact_email) <= 320),
  add column contact_phone text check (char_length(contact_phone) <= 40),
  add column time_zone text not null default 'UTC' check (char_length(time_zone) between 1 and 64),
  add column unit_system text not null default 'metric' check (unit_system in ('metric', 'imperial')),
  add column order_prefix text not null default '' check (order_prefix ~ '^[A-Z0-9-]{0,6}$'),
  add column next_order_number bigint not null default 1001 check (next_order_number between 1 and 999999999),
  add column tax_inclusive boolean not null default true;

-- A store's first time zone, units and tax display follow its country, as the prototype's do: those that exist
-- now, and each made from here on.
update store set time_zone = case country when 'IN' then 'Asia/Kolkata' when 'US' then 'America/New_York' else 'UTC' end,
  unit_system = case when country = 'US' then 'imperial' else 'metric' end,
  tax_inclusive = country is distinct from 'US';

create function store_info_defaults() returns trigger
language plpgsql
as $$
begin
  if new.time_zone = 'UTC' then
    new.time_zone := case new.country when 'IN' then 'Asia/Kolkata' when 'US' then 'America/New_York' else 'UTC' end;
  end if;
  if new.country = 'US' then
    new.unit_system := 'imperial';
    new.tax_inclusive := false;
  end if;
  return new;
end
$$;
create trigger store_info_defaults before insert on store for each row execute function store_info_defaults();

create table invoice_settings (
  store_id uuid primary key references store (id),
  legal_name text not null default '' check (char_length(legal_name) <= 200),
  tax_per_line boolean not null default true,
  email_with_dispatch boolean not null default true,
  footer text not null default '' check (char_length(footer) <= 500),
  updated_at timestamptz not null default now()
);

-- CATALOG fact 36: a tax registration per country (GSTIN, EIN or sales-tax permit, VAT number…).
create table tax_registration (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  country char(2) not null check (country ~ '^[A-Z]{2}$'),
  kind text not null check (kind in ('gst', 'ein', 'sales_tax_permit', 'vat')),
  number text not null check (char_length(number) between 3 and 30),
  valid_from date,
  created_at timestamptz not null default now()
);
create unique index tax_registration_key on tax_registration (store_id, country, kind);

create function save_store_info(info jsonb) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if app_setting_text('app.scope') <> 'store' or app_setting_text('app.seller_id') <> '' or app_setting_text('app.support') = 'read' then
    raise exception 'save_store_info: the merchant side of a store only' using errcode = '42501';
  end if;
  -- The logo is one of the store's own merchant-side images.
  if info->>'logo_asset_id' is not null and not exists (
    select 1 from asset a where a.id = (info->>'logo_asset_id')::uuid and a.store_id = app_setting_uuid('app.store_id') and a.seller_id is null and a.kind = 'image'
  ) then
    raise exception 'save_store_info: the store''s own image' using errcode = '23503';
  end if;
  update store set
    name = info->>'name',
    description = info->>'description',
    logo_asset_id = (info->>'logo_asset_id')::uuid,
    address = info->'address',
    contact_email = info->>'contact_email',
    contact_phone = info->>'contact_phone',
    time_zone = info->>'time_zone',
    unit_system = info->>'unit_system',
    order_prefix = info->>'order_prefix',
    next_order_number = (info->>'next_order_number')::bigint
  where id = app_setting_uuid('app.store_id');
end
$$;
grant select (id, store_id, seller_id, kind) on asset to app_definer;
grant update (name, description, logo_asset_id, address, contact_email, contact_phone, time_zone, unit_system, order_prefix, next_order_number) on store to app_definer;
alter function save_store_info(jsonb) owner to app_definer;
revoke execute on function save_store_info(jsonb) from public;
grant execute on function save_store_info(jsonb) to app_request;

-- Prices including tax or not (CATALOG fact 6, T4): Tax setup's, the same way.
create function set_store_tax_inclusive(inclusive boolean) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if app_setting_text('app.scope') <> 'store' or app_setting_text('app.seller_id') <> '' or app_setting_text('app.support') = 'read' then
    raise exception 'set_store_tax_inclusive: the merchant side of a store only' using errcode = '42501';
  end if;
  update store set tax_inclusive = inclusive where id = app_setting_uuid('app.store_id');
end
$$;
grant update (tax_inclusive) on store to app_definer;
alter function set_store_tax_inclusive(boolean) owner to app_definer;
revoke execute on function set_store_tax_inclusive(boolean) from public;
grant execute on function set_store_tax_inclusive(boolean) to app_request;

grant select, insert, update on invoice_settings, tax_registration to app_request;
grant delete on tax_registration to app_request;
grant select, insert, update, delete on invoice_settings, tax_registration to app_system;

do $$
declare
  t text;
begin
  foreach t in array array['invoice_settings', 'tax_registration'] loop
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
