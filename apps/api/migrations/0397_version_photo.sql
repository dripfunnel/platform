-- #1460: a version shows one of its product's photos, and several versions can show the same one (DATA-MODEL §7.3).
-- Backward-compatible: product_photo.version_id stays, so the previous release still reads; nothing writes it any more.
alter table product_version add column photo_asset_id uuid;

create function product_version_photo_check() returns trigger
language plpgsql
as $$
begin
  if new.photo_asset_id is not null and not exists (select 1 from product_photo p where p.product_id = new.product_id and p.asset_id = new.photo_asset_id) then
    raise exception 'catalogue: that photo is not one of the product''s' using errcode = '23503';
  end if;
  return new;
end
$$;

create trigger product_version_photo before insert or update of photo_asset_id on product_version for each row execute function product_version_photo_check();

-- Each photo uploaded for one version becomes a product photo that version shows. They go after the others, so the main photo stays the same.
update product_version v set photo_asset_id = ph.asset_id from product_photo ph where ph.version_id = v.id and v.deleted_at is null;
update product_photo set position = position + 100, version_id = null where version_id is not null;

grant update (photo_asset_id) on product_version to app_request, app_supplier;
grant select (photo_asset_id) on product_version to app_shop;
