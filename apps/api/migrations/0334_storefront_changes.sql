-- SAPI 17 (#318), part 4: change detection as a table, not memory (SAAS §9.1; DATA-MODEL §7.8 `storefront`). Every
-- statement that changes what a storefront shows marks the store: since when, which kinds, and how many products.
alter table storefront
  add column changes_since timestamptz,
  add column changed_kinds text[] not null default '{}',
  add column changed_count integer not null default 0 check (changed_count >= 0),
  add column change_seq bigint not null default 0,
  add column next_auto_publish_at timestamptz;

-- The change_seq a full publish froze: a publish going live clears the marks only when nothing changed since.
alter table publish_run add column change_seq bigint;

create function storefront_changed() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  kind text := case
    when tg_table_name in ('collection', 'collection_product', 'filter', 'filter_value') then 'collections'
    when tg_table_name in ('menu', 'menu_item') then 'menus'
    when tg_table_name in ('storefront_content', 'storefront_content_translation') then 'content'
    when tg_table_name in ('translation', 'store_language', 'store_currency', 'market', 'market_excluded_product', 'store_feature') then 'settings'
    else 'products'
  end;
begin
  update storefront f set
    changes_since = coalesce(f.changes_since, now()),
    changed_kinds = case when kind = any(f.changed_kinds) then f.changed_kinds else array_append(f.changed_kinds, kind) end,
    changed_count = f.changed_count + case when tg_table_name = 'product' then (select count(*) from touched_rows r where r.store_id = f.store_id) else 0 end,
    change_seq = f.change_seq + 1
  where f.store_id in (select distinct store_id from touched_rows);
  return null;
end
$$;

create function storefront_store_changed() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update storefront f set
    changes_since = coalesce(f.changes_since, now()),
    changed_kinds = case when 'settings' = any(f.changed_kinds) then f.changed_kinds else array_append(f.changed_kinds, 'settings') end,
    change_seq = f.change_seq + 1
  where f.store_id = new.id;
  return null;
end
$$;

grant select (store_id, changes_since, changed_kinds, changed_count, change_seq),
  update (changes_since, changed_kinds, changed_count, change_seq) on storefront to app_definer;
alter function storefront_changed() owner to app_definer;
alter function storefront_store_changed() owner to app_definer;

-- The same tables and store columns as the catalogue version's (0064), and the content pages a publish renders (0270).
do $$
declare
  t text;
begin
  foreach t in array array[
    'product', 'product_option', 'product_option_value', 'product_version', 'product_version_option_value', 'version_price',
    'product_photo', 'product_video', 'product_market_rule', 'product_flag', 'product_compliance', 'product_spec',
    'product_highlight', 'product_faq', 'product_related', 'product_badge', 'product_filter_value', 'product_story',
    'story_block', 'size_chart', 'collection', 'collection_product', 'filter', 'filter_value', 'menu', 'menu_item', 'badge',
    'translation', 'store_language', 'store_currency', 'market', 'market_excluded_product', 'store_feature',
    'storefront_content', 'storefront_content_translation'
  ] loop
    execute format('create trigger %I after insert on %I referencing new table as touched_rows for each statement execute function storefront_changed()', t || '_changed_insert', t);
    execute format('create trigger %I after update on %I referencing new table as touched_rows for each statement execute function storefront_changed()', t || '_changed_update', t);
    execute format('create trigger %I after delete on %I referencing old table as touched_rows for each statement execute function storefront_changed()', t || '_changed_delete', t);
  end loop;
end
$$;
create trigger store_changed after update of name, country, description, logo_asset_id, address, contact_email, contact_phone, time_zone, unit_system,
  pricing_currency, main_language, tax_inclusive on store for each row when (old is distinct from new) execute function storefront_store_changed();
