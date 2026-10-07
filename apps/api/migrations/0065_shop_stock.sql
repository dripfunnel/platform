-- SAPI 8 (#306), part 2: what a storefront may say of stock (DATA-MODEL §7.11 gives app_shop no stock table): per visible
-- version of the acting store, what's left to sell and whether it's low, never where it sits or whose it is.

create function shop_stock(version_ids uuid[]) returns table (version_id uuid, available integer, low boolean)
language sql
stable
security definer
set search_path = public
as $$
  select v.id,
    case when v.track_stock then greatest(coalesce(sum(l.on_hand - l.reserved) filter (where w.id is not null), 0), 0)::int end,
    v.track_stock and coalesce(sum(l.on_hand - l.reserved) filter (where w.id is not null), 0) <= coalesce(min(l.low_stock_threshold) filter (where w.id is not null), 5)
  from product_version v
  join product p on p.id = v.product_id
  left join stock_level l on l.version_id = v.id
  left join warehouse w on w.id = l.warehouse_id and w.deleted_at is null
  where app_setting_text('app.scope') = 'shop' and v.store_id = app_setting_uuid('app.store_id') and v.id = any (version_ids)
    and v.deleted_at is null and v.visibility = 'visible'
    and p.deleted_at is null and p.visibility = 'visible' and p.hidden_by is null and coalesce(p.approval_status, 'approved') = 'approved'
    and (p.publish_at is null or p.publish_at <= now()) and not p.is_sample
  group by v.id, v.track_stock
$$;
grant select (id, product_id, store_id, deleted_at, visibility, track_stock) on product_version to app_definer;
grant select (id, deleted_at, visibility, hidden_by, approval_status, publish_at, is_sample) on product to app_definer;
grant select (version_id, warehouse_id, on_hand, reserved, low_stock_threshold) on stock_level to app_definer;
grant select (id, deleted_at) on warehouse to app_definer;
alter function shop_stock(uuid[]) owner to app_definer;
revoke execute on function shop_stock(uuid[]) from public;
grant execute on function shop_stock(uuid[]) to app_shop;
