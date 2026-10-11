-- INF 5 (#484): a renamed product's old address answers 301 to its new one at the edge (storefront ARCHITECTURE §8,
-- DATA-MODEL §7.8). Written by triggers wherever a product's address changes in any language, so an import, a
-- supplier's save or a translation each leave the same redirect. Nothing here is destructive.

-- A product's address in one of the store's languages: `/products/{slug}` in its main language (core's routeAddresses,
-- #483), under the language tag lowercased in any other (decided on #484). Kept without a trailing slash.
create function storefront_product_path(store uuid, language text, slug text) returns text
language sql stable
as $$
  select case when language = (select s.main_language from store s where s.id = store) then '' else '/' || lower(language) end || '/products/' || slug
$$;

create table storefront_redirect (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  -- Plain names on the store's own host, as the edge Worker serves a path (LIVE-SHOP §5 step 6).
  from_path text not null check (char_length(from_path) <= 2048 and from_path ~ '^(/[A-Za-z0-9._~@+,=-]+)+$'),
  to_path text not null check (char_length(to_path) <= 2048 and to_path ~ '^(/[A-Za-z0-9._~@+,=-]+)+$'),
  language text,
  reason text not null check (reason in ('renamed', 'removed', 'merged')),
  created_at timestamptz not null default now(),
  check (from_path <> to_path)
);
-- The path names its language, so one address has one redirect.
create unique index storefront_redirect_from_key on storefront_redirect (store_id, from_path);

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
  on conflict (store_id, from_path) do update set to_path = excluded.to_path, language = excluded.language, reason = 'renamed', created_at = now();
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
alter function storefront_redirect_translated_slug() owner to app_definer;
create trigger storefront_redirect_product_slug after update of slug on product for each row execute function storefront_redirect_product_slug();
create trigger storefront_redirect_translated_slug after insert or update of text or delete on translation for each row execute function storefront_redirect_translated_slug();

-- The merchant side reads its own store's; the edge reads them in system scope; partners and staff never (DATA-MODEL §5).
grant select on storefront_redirect to app_request;
grant select on storefront_redirect to app_system;

alter table storefront_redirect enable row level security;
alter table storefront_redirect force row level security;
create policy storefront_redirect_system on storefront_redirect for select to app_system using (true);
create policy storefront_redirect_merchant on storefront_redirect for select to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '');
create policy request_scope on storefront_redirect as restrictive for all to app_request
using (app_setting_text('app.scope') = 'store') with check (app_setting_text('app.scope') = 'store');
create policy partner_scope on storefront_redirect as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on storefront_redirect as restrictive for all to app_platform using (false) with check (false);
create policy system_scope on storefront_redirect as restrictive for all to app_system
using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');

create index storefront_redirect_to_idx on storefront_redirect (store_id, to_path);
-- The edge reads a store's newest redirects as one list (LIVE-SHOP §5 step 6).
create index storefront_redirect_newest_idx on storefront_redirect (store_id, created_at desc);
