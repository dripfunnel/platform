-- INF 5 (#484): the single-page render (storefront LIVE-SHOP.md §7): a new or renamed product's page, rendered at once in
-- the store's workflow with a one-page input, into a new build folder the API completes from the live build's files.
-- IndexNow's key per store (ARCHITECTURE §8). Nothing here is destructive: new columns, functions and triggers only.

alter table publish_run
  -- A page run's input: the addresses to render and the ones whose files the new folder leaves out (a renamed page's).
  add column render jsonb check (render is null or jsonb_typeof(render) = 'object'),
  -- The build whose asset folder this build's pages load their JS and CSS from: its own, or for a page run the live
  -- build's, which the same commit builds byte for byte. Clean-up keeps a build while one names it.
  add column assets_build_id uuid references publish_run (id),
  add constraint publish_run_render_is_page check ((render is not null) = (kind = 'page'));
create index publish_run_assets_build_idx on publish_run (assets_build_id) where assets_build_id is not null;

-- IndexNow's key for the store's hosts, which the edge Worker serves at /{key}.txt (indexnow.org: 8–128 of a-z, 0-9, -).
alter table storefront add column indexnow_key text not null default replace(gen_random_uuid()::text, '-', '') check (indexnow_key ~ '^[a-f0-9]{32}$');

-- A product's address in every language the store offers: its translated slug where it has one (DATA-MODEL §7.8).
create function storefront_product_paths(store uuid, product uuid, main_slug text) returns text[]
language sql stable
as $$
  select coalesce(array_agg(storefront_product_path(store, l.language, coalesce(t.text, main_slug)) order by l.position, l.language), '{}')
  from store_language l
  left join translation t on t.store_id = store and t.entity = 'product' and t.entity_id = product::text and t.field = 'slug' and t.language = l.language
  where l.store_id = store and l.status = 'active'
$$;

-- Asks for a single-page render through the outbox, once the store has a live build to render beside (SAAS §9.1).
create function storefront_render_queue(store uuid, pages text[], drop_paths text[]) returns void
language plpgsql
set search_path = public
as $$
declare
  partner uuid;
begin
  select s.partner_id into partner from store s join storefront f on f.store_id = s.id where s.id = store and f.live_build_id is not null;
  if partner is null or coalesce(array_length(pages, 1), 0) = 0 then
    return;
  end if;
  insert into outbox (kind, idempotency_key, payload, partner_id, store_id)
  values ('storefront.render', 'render:' || gen_random_uuid(), jsonb_build_object('storeId', store, 'pages', to_jsonb(pages), 'drop', to_jsonb(coalesce(drop_paths, '{}'))), partner, store);
end
$$;

-- A product that becomes visible, or a visible one whose address changes, gets its page at once.
create function storefront_render_product() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deleted_at is not null or new.visibility <> 'visible' then
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

-- A translated address moves that language's page.
create function storefront_render_translated_slug() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_ translation;
  main text;
  old_slug text;
  new_slug text;
begin
  if tg_op = 'DELETE' then
    row_ := old;
  else
    row_ := new;
  end if;
  if row_.entity <> 'product' or row_.field <> 'slug' then
    return null;
  end if;
  select p.slug into main from product p where p.id = row_.entity_id::uuid and p.store_id = row_.store_id and p.deleted_at is null and p.visibility = 'visible';
  if main is null then
    return null;
  end if;
  old_slug := case when tg_op = 'INSERT' then main else old.text end;
  new_slug := case when tg_op = 'DELETE' then main else new.text end;
  if old_slug <> new_slug then
    perform storefront_render_queue(row_.store_id, array[storefront_product_path(row_.store_id, row_.language, new_slug)], array[storefront_product_path(row_.store_id, row_.language, old_slug)]);
  end if;
  return null;
end
$$;

grant insert on outbox to app_definer;
grant select (store_id, live_build_id) on storefront to app_definer;
grant select (id, partner_id) on store to app_definer;
alter function storefront_render_product() owner to app_definer;
alter function storefront_render_translated_slug() owner to app_definer;
create trigger storefront_render_product after insert or update of slug, visibility, deleted_at on product for each row execute function storefront_render_product();
create trigger storefront_render_translated_slug after insert or update of text or delete on translation for each row execute function storefront_render_translated_slug();
