-- A store category's sample catalog (DATA-MODEL §7.2, CATALOG-DESIGN A4): 6 products and 2 collections staff upload
-- once, which a store's merchant side imports through the ordinary import while it has no order. Nothing here is
-- destructive: one new table and one nullable column.

create table store_category_sample (
  category_id uuid primary key references store_category (id),
  -- The merchant import's own file format (CATALOG K) plus the sample-only `collection` column.
  file text not null check (octet_length(file) between 1 and 1048576),
  -- The file's prices are in this currency, converted to each store's at import (CATALOG fact 26).
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  -- [{name, skus: [...]}], exactly two, read from the file's `collection` column at upload.
  collections jsonb not null check (jsonb_typeof(collections) = 'array' and jsonb_array_length(collections) = 2),
  -- {url: R2 key}: each photo copied once at upload; a sample import reads these, never the URL.
  photos jsonb not null default '{}' check (jsonb_typeof(photos) = 'object'),
  uploaded_by uuid references staff_user (id),
  uploaded_at timestamptz not null default now()
);

grant select on store_category_sample to app_request, app_system;
grant select, insert, update, delete on store_category_sample to app_platform;
alter table store_category_sample enable row level security;
alter table store_category_sample force row level security;
create policy store_category_sample_read on store_category_sample for select to app_request, app_system using (true);
create policy store_category_sample_platform on store_category_sample for all to app_platform using (true) with check (true);
create policy request_scope on store_category_sample as restrictive for all to app_request
using (app_setting_text('app.scope') = 'store' and app_setting_text('app.seller_id') = '') with check (false);
create policy partner_scope on store_category_sample as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on store_category_sample as restrictive for all to app_platform
using (app_setting_text('app.scope') = 'platform') with check (app_setting_text('app.scope') = 'platform');
create policy system_scope on store_category_sample as restrictive for all to app_system
using (app_setting_text('app.scope') = 'system') with check (false);

-- The import a store's "Add sample catalog" started: its photos come from the sample's copies, and it makes the
-- sample's collections when it finishes. Set at insert only.
alter table catalog_import add column sample_category_id uuid references store_category (id);
-- One on its way per store at a time, so a double click starts one (the second insert is refused).
create unique index catalog_import_one_sample on catalog_import (store_id)
where sample_category_id is not null and state in ('checking', 'ready', 'running');

-- Set once a store's sample import finishes, so a second is refused after its job row is long gone (imports are
-- deleted a day after they end). Written through the definer below alone, as setup_skipped is (0351).
alter table store add column sample_catalog_added_at timestamptz;

create function set_sample_catalog_added() returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if app_setting_text('app.scope') <> 'store' or app_setting_text('app.seller_id') <> '' or app_setting_text('app.support') = 'read' then
    raise exception 'set_sample_catalog_added: the merchant side of a store only' using errcode = '42501';
  end if;
  update store set sample_catalog_added_at = coalesce(sample_catalog_added_at, now()) where id = app_setting_uuid('app.store_id');
end
$$;
grant select (id, sample_catalog_added_at) on store to app_definer;
grant update (sample_catalog_added_at) on store to app_definer;
alter function set_sample_catalog_added() owner to app_definer;
revoke execute on function set_sample_catalog_added() from public;
grant execute on function set_sample_catalog_added() to app_request;
