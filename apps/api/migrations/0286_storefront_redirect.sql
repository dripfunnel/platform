-- INF 5 (#484): a renamed product's old address answers 301 to its new one at the edge (storefront ARCHITECTURE §8,
-- DATA-MODEL §7.8), in #338's storefront_redirect (0270). Written by triggers wherever a product's address changes in
-- any language, so an import, a supplier's save or a translation each leave the same redirect. Nothing is destructive.

-- A product's address in one of the store's languages: `/products/{slug}` in its main language (core's routeAddresses,
-- #483), under the language tag lowercased in any other (decided on #484). Kept without a trailing slash.
create function storefront_product_path(store uuid, language text, slug text) returns text
language sql stable
as $$
  select case when language = (select s.main_language from store s where s.id = store) then '' else '/' || lower(language) end || '/products/' || slug
$$;

-- Moves an address: the redirects that pointed at the old one follow it (no chains), and one away from the new address
-- goes, since that address is live again.
-- Called only from the triggers below, so it runs as their owner.
create function storefront_redirect_move(store uuid, lang text, old_path text, new_path text) returns void
language plpgsql
set search_path = public
as $$
begin
  if old_path = new_path then
    return;
  end if;
  delete from storefront_redirect where store_id = store and from_path = new_path;
  update storefront_redirect set to_path = new_path where store_id = store and to_path = old_path;
  insert into storefront_redirect (store_id, from_path, to_path, language, reason)
  values (store, old_path, new_path, lang, 'renamed')
  on conflict (store_id, from_path, language) do update set to_path = excluded.to_path, reason = 'renamed', created_at = now();
end
$$;

-- The main slug is the address in every language without a translated one.
create function storefront_redirect_product_slug() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  lang text;
begin
  if new.slug is distinct from old.slug and new.deleted_at is null then
    for lang in
      select l.language from store_language l
      where l.store_id = new.store_id and l.status = 'active'
        and not exists (select 1 from translation t where t.store_id = new.store_id and t.entity = 'product' and t.entity_id = new.id::text and t.field = 'slug' and t.language = l.language)
    loop
      perform storefront_redirect_move(new.store_id, lang, storefront_product_path(new.store_id, lang, old.slug), storefront_product_path(new.store_id, lang, new.slug));
    end loop;
  end if;
  return null;
end
$$;

-- A new product holds its addresses again: a redirect left there by a renamed one would hide its page before it renders.
create function storefront_redirect_product_added() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from storefront_redirect r
  using store_language l
  where l.store_id = new.store_id and l.status = 'active' and r.store_id = new.store_id
    and r.from_path = storefront_product_path(new.store_id, l.language, new.slug);
  return null;
end
$$;

-- A translated slug replaces the main one in its language, and removing it brings the main one back.
create function storefront_redirect_translated_slug() returns trigger
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
  select p.slug into main from product p where p.id = row_.entity_id::uuid and p.store_id = row_.store_id and p.deleted_at is null;
  if main is null then
    return null;
  end if;
  old_slug := case when tg_op = 'INSERT' then main else old.text end;
  new_slug := case when tg_op = 'DELETE' then main else new.text end;
  perform storefront_redirect_move(row_.store_id, row_.language, storefront_product_path(row_.store_id, row_.language, old_slug), storefront_product_path(row_.store_id, row_.language, new_slug));
  return null;
end
$$;

grant select, insert, update, delete on storefront_redirect to app_definer;
grant select on product, store_language, translation to app_definer;
grant select (id, main_language) on store to app_definer;
alter function storefront_redirect_product_slug() owner to app_definer;
alter function storefront_redirect_product_added() owner to app_definer;
alter function storefront_redirect_translated_slug() owner to app_definer;
create trigger storefront_redirect_product_slug after update of slug on product for each row execute function storefront_redirect_product_slug();
create trigger storefront_redirect_product_added after insert on product for each row execute function storefront_redirect_product_added();
create trigger storefront_redirect_translated_slug after insert or update of text or delete on translation for each row execute function storefront_redirect_translated_slug();

-- The edge reads a store's newest redirects as one list (LIVE-SHOP §5 step 6).
create index storefront_redirect_newest_idx on storefront_redirect (store_id, created_at desc);
