-- #1011: a live build prerenders each product's page (storefront ARCHITECTURE §4.2), so a product that leaves the
-- storefront (hidden or deleted) has its pages dropped at once by a page run, as a renamed one's old address is
-- (LIVE-SHOP §7). Nothing here is destructive: two functions replaced with the same signatures.

-- A render may now only drop addresses.
create or replace function storefront_render_queue(store uuid, pages text[], drop_paths text[]) returns void
language plpgsql
set search_path = public
as $$
declare
  partner uuid;
begin
  select s.partner_id into partner from store s join storefront f on f.store_id = s.id where s.id = store and f.live_build_id is not null;
  if partner is null or coalesce(array_length(pages, 1), 0) + coalesce(array_length(drop_paths, 1), 0) = 0 then
    return;
  end if;
  insert into outbox (kind, idempotency_key, payload, partner_id, store_id)
  values ('storefront.render', 'render:' || gen_random_uuid(), jsonb_build_object('storeId', store, 'pages', to_jsonb(coalesce(pages, '{}')), 'drop', to_jsonb(coalesce(drop_paths, '{}'))), partner, store);
end
$$;

-- A product that becomes visible, or a visible one whose address changes, gets its page at once; one that leaves the
-- storefront loses its pages.
create or replace function storefront_render_product() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deleted_at is not null or new.visibility <> 'visible' then
    if tg_op = 'UPDATE' and old.deleted_at is null and old.visibility = 'visible' then
      perform storefront_render_queue(new.store_id, '{}', storefront_product_paths(new.store_id, new.id, old.slug));
    end if;
    return null;
  end if;
  if tg_op = 'INSERT' or old.visibility is distinct from new.visibility or old.deleted_at is not null then
    perform storefront_render_queue(new.store_id, storefront_product_paths(new.store_id, new.id, new.slug), '{}');
  elsif old.slug is distinct from new.slug then
    perform storefront_render_queue(new.store_id, storefront_product_paths(new.store_id, new.id, new.slug), storefront_product_paths(new.store_id, new.id, old.slug));
  end if;
  return null;
end
$$;
