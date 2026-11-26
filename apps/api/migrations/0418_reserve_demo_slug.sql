-- #1732: `demo.<SHOP_DOMAIN>` serves the templates' demos (storefront PREVIEW.md §9) and the slug `demo` is reserved, so a
-- store already holding it would lose its free address. Stop the deploy rather than rename a store: USERS-AND-DOMAINS §2.

do $$
begin
  if exists (select 1 from store where slug = 'demo') then
    raise exception 'slug: a store holds the slug "demo", which #1732 reserves for the templates'' demos; decide its new address first';
  end if;
end
$$;
