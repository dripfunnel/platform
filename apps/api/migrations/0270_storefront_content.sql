-- SAPI 24 (#338), part 1: content pages and the blog (DATA-MODEL §7.8; storefront ARCHITECTURE §3.1), and the
-- redirects a renamed one leaves. Nothing here is destructive: two new tables.

-- A content page (FAQ, lookbook, the merchant's own) at /{slug}, or a blog post at /blog/{slug}, in the store's main
-- language. Every non-deleted row's path is taken in the store's one namespace, drafts included.
create table storefront_content (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  kind text not null check (kind in ('page', 'post')),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 100),
  title text not null check (char_length(title) between 1 and 200),
  body jsonb not null default '[]' check (jsonb_typeof(body) = 'array' and pg_column_size(body) <= 262144),
  seo_title text check (char_length(seo_title) between 1 and 60),
  seo_description text check (char_length(seo_description) between 1 and 160),
  status text not null check (status in ('draft', 'scheduled', 'published')),
  -- A post's date: when a scheduled one goes live, and the date shoppers see. Pages have none.
  publish_at timestamptz,
  -- When it first went live: a rename before then leaves no redirect, since no one has the old address.
  published_at timestamptz,
  -- A page shown in the footer menu (StorefrontContent's "Show in the footer menu").
  in_menu boolean not null default false,
  author text check (char_length(author) between 1 and 80),
  tags text[] not null default '{}' check (cardinality(tags) <= 20),
  cover_asset_id uuid,
  -- What the body names, kept by the engine with every save, so "is this file shown" is a query.
  asset_ids uuid[] not null default '{}',
  product_ids uuid[] not null default '{}',
  -- When what a shopper sees last changed: newer than the live build means it waits for the next publish.
  changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  revision integer not null default 1,
  deleted_at timestamptz,
  foreign key (cover_asset_id, store_id) references asset (id, store_id),
  check ((kind = 'post') = (publish_at is not null)),
  check (kind = 'post' or (status <> 'scheduled' and author is null and cardinality(tags) = 0 and cover_asset_id is null)),
  check (kind = 'page' or not in_menu)
);
create unique index storefront_content_slug_key on storefront_content (store_id, kind, slug) where deleted_at is null;
create index storefront_content_pages_idx on storefront_content (store_id, updated_at desc, id desc) where kind = 'page' and deleted_at is null;
create index storefront_content_posts_idx on storefront_content (store_id, publish_at desc, id desc) where kind = 'post' and deleted_at is null;
create index storefront_content_due_idx on storefront_content (publish_at) where status = 'scheduled' and deleted_at is null;
create index storefront_content_assets_idx on storefront_content using gin (asset_ids);

-- The 301s of storefront ARCHITECTURE §8: written by the engine when a product, collection, content page or custom page
-- changes address; the edge reads them per store. A null language is every language.
create table storefront_redirect (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  from_path text not null check (from_path ~ '^/[a-z0-9/-]*$' and char_length(from_path) <= 512),
  to_path text not null check (to_path ~ '^/[a-z0-9/-]*$' and char_length(to_path) <= 512),
  language text check (language ~ '^[a-z]{2,3}-[A-Z]{2}$'),
  reason text not null check (reason in ('renamed', 'removed', 'merged')),
  created_at timestamptz not null default now(),
  check (from_path <> to_path)
);
create unique index storefront_redirect_from_key on storefront_redirect (store_id, from_path, language) nulls not distinct;
create index storefront_redirect_to_idx on storefront_redirect (store_id, to_path);

-- The merchant side writes both through the engine; the publishing job and the edge read them in system scope.
grant select, insert, update on storefront_content to app_request;
grant select, insert, update, delete on storefront_redirect to app_request;
grant select, insert, update, delete on storefront_content, storefront_redirect to app_system;

do $$
declare
  t text;
begin
  foreach t in array array['storefront_content', 'storefront_redirect'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %I on %I for all to app_system using (true) with check (true)', t || '_system', t);
    -- The store's own content: the merchant side only, never a supplier (ACCESS §5.1 `publish`).
    execute format('create policy %I on %I for all to app_request
      using (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'') and app_setting_text(''app.seller_id'') = '''')
      with check (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'') and app_setting_text(''app.seller_id'') = '''')', t || '_merchant', t);
    execute format('create policy request_scope on %I as restrictive for all to app_request
      using (app_setting_text(''app.scope'') = ''store'') with check (app_setting_text(''app.scope'') = ''store'')', t);
    execute format('create policy partner_scope on %I as restrictive for all to app_partner using (false) with check (false)', t);
    execute format('create policy platform_scope on %I as restrictive for all to app_platform using (false) with check (false)', t);
    execute format('create policy system_scope on %I as restrictive for all to app_system
      using (app_setting_text(''app.scope'') = ''system'') with check (app_setting_text(''app.scope'') = ''system'')', t);
    execute format('create policy support_no_insert on %I as restrictive for insert to app_request with check (app_setting_text(''app.support'') <> ''read'')', t);
    execute format('create policy support_no_update on %I as restrictive for update to app_request with check (app_setting_text(''app.support'') <> ''read'')', t);
    execute format('create policy support_no_delete on %I as restrictive for delete to app_request using (app_setting_text(''app.support'') <> ''read'')', t);
  end loop;
end
$$;
