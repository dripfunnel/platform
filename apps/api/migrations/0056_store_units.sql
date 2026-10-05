-- SUI 4 (#298): the store's unit system, for the product editor's weight and box, which a supplier needs and
-- reads no store row for (as store_pricing_currency(), 0041).

create function store_unit_system() returns text
language sql
stable
security definer
set search_path = public
as $$
  select unit_system from store where id = app_setting_uuid('app.store_id') and app_setting_text('app.scope') = 'store'
$$;

grant select (id, unit_system) on store to app_definer;
alter function store_unit_system() owner to app_definer;
revoke execute on function store_unit_system() from public;
grant execute on function store_unit_system() to app_request, app_supplier;
