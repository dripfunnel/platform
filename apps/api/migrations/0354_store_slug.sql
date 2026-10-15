-- #744: store.slug, the platform-unique name of a store's free addresses {slug}.<SHOP_DOMAIN> and {slug}-preview.<SHOP_DOMAIN>
-- (USERS-AND-DOMAINS §2, SAAS §4.1). store.code stays unique per partner. A slug is set at signup or Create store and never changes.
-- Plan:
--   1. store.slug is added, filled from code (lowercased, other characters turned to '-', at most 39 characters, never ending in
--      '-preview' and never a reserved name, which get '-store'), with '-2', '-3'… on a clash, oldest store first, then made not null and unique on lower(slug).
--   2. A before-insert trigger gives a store inserted without a slug the same treatment, so no insert path can leave one out;
--      signup and Create store pass the slug they checked.
--   3. store_slug_taken() (stores and sign-ups in progress) and store_slug_in_use() (stores) answer across every partner, which a
--      partner's own scope cannot see; neither says who holds a slug.
-- Between this migration and the promotion of the build that ships with it (ARCHITECTURE §6), the old build still runs. The window
-- is harmless: its store inserts get a slug from the trigger, and nothing reads slug before the new build.
create function new_store_slug(base text) returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  stem text := left(trim(both '-' from regexp_replace(lower(coalesce(base, '')), '[^a-z0-9]+', '-', 'g')), 39);
  candidate text;
  n int := 1;
begin
  if stem = '' then stem := 'store'; end if;
  -- A reserved name, or one ending in '-preview' (another store's preview host), takes '-store' after it.
  if stem ~ '-preview$' or stem in ('admin', 'api', 'app', 'help', 'hooks', 'mail', 'platform', 'portal', 'preview', 'shop', 'shops', 'status', 'store', 'support', 'www') then
    stem := left(stem, 31) || '-store';
  end if;
  loop
    candidate := case when n = 1 then stem else left(stem, 39 - length('-' || n)) || '-' || n end;
    candidate := trim(both '-' from candidate);
    exit when not exists (select 1 from store where lower(slug) = candidate);
    n := n + 1;
  end loop;
  return candidate;
end
$$;
alter function new_store_slug(text) owner to app_definer;
revoke execute on function new_store_slug(text) from public;
alter table store add column slug text check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$' and slug !~ '-preview$');
do $$
declare
  s record;
begin
  for s in select id, code from store where slug is null order by created_at, id loop
    update store set slug = new_store_slug(s.code) where id = s.id;
  end loop;
end
$$;
alter table store alter column slug set not null;
create unique index store_slug_key on store (lower(slug));
create function store_slug_default() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.slug is null then new.slug := new_store_slug(new.code); end if;
  return new;
end
$$;
alter function store_slug_default() owner to app_definer;
revoke execute on function store_slug_default() from public;
create trigger store_slug_default before insert on store for each row execute function store_slug_default();
-- app_definer reads sign-ups only through store_slug_taken(), which answers a boolean and no row.
grant select (id, subdomain, expires_at, stage) on signup to app_definer;
create function store_slug_taken(candidate text, own_signup uuid) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from store where lower(slug) = lower(candidate))
    or exists (
      select 1 from signup
      where lower(subdomain) = lower(candidate) and id is distinct from own_signup and expires_at > now() and stage in ('phone', 'provisioning')
    )
$$;
alter function store_slug_taken(text, uuid) owner to app_definer;
revoke execute on function store_slug_taken(text, uuid) from public;
create function store_slug_in_use(candidate text) returns boolean
language sql
stable
security definer
set search_path = public
as $$ select exists (select 1 from store where lower(slug) = lower(candidate)) $$;
alter function store_slug_in_use(text) owner to app_definer;
revoke execute on function store_slug_in_use(text) from public;
grant execute on function new_store_slug(text), store_slug_taken(text, uuid), store_slug_in_use(text) to app_request, app_system, app_partner, app_platform;
