-- SAPI 3, part 1 (#293): the catalogue's core, DATA-MODEL §7.3 (product, options, versions, prices and
-- their history) and the two store columns it needs from §7.2. Store-and-seller class (§7.11).

-- §7.2. The currency every product is priced in first (CATALOG fact 25), and the language its text is in.
alter table store add column pricing_currency char(3) check (pricing_currency ~ '^[A-Z]{3}$');
alter table store add column main_language text not null default 'en' check (main_language ~ '^[a-z]{2,3}(-[A-Z]{2})?$');
-- A store made before this priced its plan in its country's currency, which is the one it sells in.
update store s set pricing_currency = (
  select ss.currency from store_subscription ss where ss.store_id = s.id order by ss.period_start desc limit 1
) where pricing_currency is null;
grant insert (pricing_currency) on store to app_partner;

-- Children name their store with their parent, so a row can never point into another store.
create unique index seller_id_store_key on seller (id, store_id);

create table product (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  seller_id uuid,
  name text not null check (char_length(name) between 1 and 255),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 120),
  description text not null default '' check (char_length(description) <= 20000),
  -- FIRST-RELEASE §11's four kinds.
  product_type text not null default 'physical' check (product_type in ('physical', 'digital', 'service', 'gift_card')),
  category text check (char_length(category) <= 120),
  visibility text not null default 'hidden' check (visibility in ('visible', 'hidden')),
  approval_status text check (approval_status in ('approved', 'pending', 'sent_back')),
  sent_back_reason text,
  hidden_by text check (hidden_by in ('seller_suspended', 'seller_removed', 'plan')),
  status_before_hide text check (status_before_hide in ('visible', 'hidden')),
  publish_at timestamptz,
  related_mode text not null default 'manual' check (related_mode in ('manual', 'auto_collection')),
  warranty_text text check (char_length(warranty_text) <= 5000),
  returns_text text check (char_length(returns_text) <= 5000),
  is_sample boolean not null default false,
  seo_title text check (char_length(seo_title) <= 120),
  seo_description text check (char_length(seo_description) <= 320),
  -- The portal's search, in the main language (§7.1 "Search"); the storefront's index comes with the Shop API.
  search tsvector generated always as (to_tsvector('simple', name || ' ' || description)) stored,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  deleted_at timestamptz,
  foreign key (seller_id, store_id) references seller (id, store_id)
);

create unique index product_id_store_key on product (id, store_id);
create unique index product_slug_key on product (store_id, slug) where deleted_at is null;
create index product_list_idx on product (store_id, created_at desc, id desc) where deleted_at is null;
create index product_seller_list_idx on product (store_id, seller_id, created_at desc, id desc) where deleted_at is null;
create index product_visibility_idx on product (store_id, visibility, created_at desc, id desc) where deleted_at is null;
create index product_approval_idx on product (store_id, approval_status, created_at desc, id desc) where deleted_at is null and approval_status is not null;
create index product_search_idx on product using gin (search);
create index product_name_trgm_idx on product using gin (name gin_trgm_ops);

create table product_option (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null,
  store_id uuid not null,
  seller_id uuid,
  name text not null check (char_length(name) between 1 and 60),
  position integer not null check (position between 0 and 2),
  created_at timestamptz not null default now(),
  foreign key (product_id, store_id) references product (id, store_id) on delete cascade,
  unique (product_id, position) deferrable initially deferred
);

create unique index product_option_id_product_key on product_option (id, product_id);
create unique index product_option_name_key on product_option (product_id, lower(name));

create table product_option_value (
  id uuid primary key default gen_random_uuid(),
  option_id uuid not null references product_option (id) on delete cascade,
  store_id uuid not null references store (id),
  seller_id uuid,
  name text not null check (char_length(name) between 1 and 60),
  position integer not null check (position >= 0),
  created_at timestamptz not null default now()
);

create unique index product_option_value_id_option_key on product_option_value (id, option_id);
create unique index product_option_value_name_key on product_option_value (option_id, lower(name));

create table product_version (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null,
  store_id uuid not null,
  seller_id uuid,
  sku text check (char_length(sku) between 1 and 64),
  barcode text check (barcode ~ '^[0-9]{8,14}$'),
  name text check (char_length(name) <= 255),
  visibility text not null default 'visible' check (visibility in ('visible', 'hidden')),
  hs_code text check (hs_code ~ '^[0-9]{6,10}$'),
  customs_description text check (char_length(customs_description) <= 255),
  weight_grams integer check (weight_grams >= 0),
  length_mm integer check (length_mm >= 0),
  width_mm integer check (width_mm >= 0),
  height_mm integer check (height_mm >= 0),
  -- Never granted to the shopper role when it arrives (§7.11 column rules).
  cost_amount bigint check (cost_amount >= 0),
  cost_currency char(3) check (cost_currency ~ '^[A-Z]{3}$'),
  track_stock boolean,
  continue_selling boolean,
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (product_id, store_id) references product (id, store_id),
  -- §7.1 Money: an amount never without its currency.
  check ((cost_amount is null) = (cost_currency is null))
);

create unique index product_version_id_store_key on product_version (id, store_id);
create unique index product_version_sku_key on product_version (store_id, sku) where sku is not null and deleted_at is null;
create index product_version_product_idx on product_version (product_id, position) where deleted_at is null;

create table product_version_option_value (
  version_id uuid not null,
  option_id uuid not null,
  value_id uuid not null,
  store_id uuid not null,
  seller_id uuid,
  primary key (version_id, option_id),
  foreign key (version_id, store_id) references product_version (id, store_id),
  foreign key (value_id, option_id) references product_option_value (id, option_id) on delete cascade
);

create table version_price (
  version_id uuid not null,
  store_id uuid not null,
  seller_id uuid,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  amount bigint not null check (amount >= 0),
  compare_at_amount bigint check (compare_at_amount >= 0),
  source text not null default 'manual' check (source in ('manual', 'converted')),
  primary key (version_id, currency),
  foreign key (version_id, store_id) references product_version (id, store_id)
);

-- The EU 30-day reference price and the history the editor shows (fact 41): one row per price held.
create table price_history (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null,
  store_id uuid not null,
  seller_id uuid,
  currency char(3) not null,
  amount bigint not null,
  compare_at_amount bigint,
  from_at timestamptz not null,
  to_at timestamptz,
  foreign key (version_id, store_id) references product_version (id, store_id)
);

create index price_history_version_idx on price_history (version_id, currency, from_at desc);
create unique index price_history_open_key on price_history (version_id, currency) where to_at is null;

-- §7.1: a child's owner is its parent's, copied from the row it points at and never from input. As the
-- caller, so a parent the caller can't read (another supplier's product) refuses the write.
create function catalogue_owner_from_product() returns trigger
language plpgsql
as $$
declare
  owner record;
begin
  select p.store_id, p.seller_id into owner from product p where p.id = new.product_id;
  if not found or owner.store_id is distinct from new.store_id then
    raise exception 'catalogue: no such product in this store' using errcode = '23503';
  end if;
  new.seller_id := owner.seller_id;
  return new;
end
$$;

create function catalogue_owner_from_option() returns trigger
language plpgsql
as $$
declare
  owner record;
begin
  select o.store_id, o.seller_id into owner from product_option o where o.id = new.option_id;
  if not found or owner.store_id is distinct from new.store_id then
    raise exception 'catalogue: no such option in this store' using errcode = '23503';
  end if;
  new.seller_id := owner.seller_id;
  return new;
end
$$;

create function catalogue_owner_from_version() returns trigger
language plpgsql
as $$
declare
  owner record;
begin
  select v.store_id, v.seller_id into owner from product_version v where v.id = new.version_id;
  if not found or owner.store_id is distinct from new.store_id then
    raise exception 'catalogue: no such version in this store' using errcode = '23503';
  end if;
  new.seller_id := owner.seller_id;
  return new;
end
$$;

create trigger product_option_owner before insert or update on product_option for each row execute function catalogue_owner_from_product();
create trigger product_version_owner before insert or update on product_version for each row execute function catalogue_owner_from_product();
create trigger product_option_value_owner before insert or update on product_option_value for each row execute function catalogue_owner_from_option();
create trigger product_version_option_value_owner before insert or update on product_version_option_value for each row execute function catalogue_owner_from_version();
create trigger version_price_owner before insert or update on version_price for each row execute function catalogue_owner_from_version();

-- A supplier never sets visibility, approval or a hide (ACCESS §7.2, CATALOG fact 16), whatever it sends;
-- the merchant's side and the engine's system scope may.
create function product_supplier_guard() returns trigger
language plpgsql
as $$
begin
  if app_setting_text('app.seller_id') = '' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.seller_id is distinct from app_setting_uuid('app.seller_id') or new.approval_status is not null or new.hidden_by is not null then
      raise exception 'catalogue: a supplier creates only its own products, with no approval or hide' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.seller_id is distinct from old.seller_id or new.visibility is distinct from old.visibility
     or new.approval_status is distinct from old.approval_status or new.sent_back_reason is distinct from old.sent_back_reason
     or new.hidden_by is distinct from old.hidden_by or new.status_before_hide is distinct from old.status_before_hide
     or new.is_sample is distinct from old.is_sample then
    raise exception 'catalogue: a supplier changes no visibility, approval or hide' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger product_supplier_guard before insert or update on product for each row execute function product_supplier_guard();

-- Every price change closes the price it replaces and opens the new one, written by the engine's own
-- definer from the row that passed RLS, so a request can't forge or rewrite history.
create function version_price_history() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update price_history set to_at = now() where version_id = old.version_id and currency = old.currency and to_at is null;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    insert into price_history (version_id, store_id, seller_id, currency, amount, compare_at_amount, from_at)
    values (new.version_id, new.store_id, new.seller_id, new.currency, new.amount, new.compare_at_amount, now());
  end if;
  return null;
end
$$;

grant select (version_id, currency, to_at), insert, update (to_at) on price_history to app_definer;
alter function version_price_history() owner to app_definer;
revoke execute on function version_price_history() from public;

create trigger version_price_history after insert or update of amount, compare_at_amount or delete on version_price
  for each row execute function version_price_history();

-- The plan's product limit counts the whole store's catalogue, a supplier's action included
-- (SAAS §6.2), which a supplier's own scope can't count: a number only, never a row.
create function store_product_count() returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer from product
  where store_id = app_setting_uuid('app.store_id') and app_setting_text('app.scope') = 'store'
    and deleted_at is null and not is_sample and hidden_by is distinct from 'plan'
$$;

grant select (store_id, deleted_at, is_sample, hidden_by) on product to app_definer;
alter function store_product_count() owner to app_definer;
revoke execute on function store_product_count() from public;
grant execute on function store_product_count() to app_request;

-- A supplier prices in the store's currency but never reads the store row (0003 store_read): the code only.
create function store_pricing_currency() returns text
language sql
stable
security definer
set search_path = public
as $$
  select pricing_currency::text from store where id = app_setting_uuid('app.store_id') and app_setting_text('app.scope') = 'store'
$$;

grant select (id, pricing_currency) on store to app_definer;
alter function store_pricing_currency() owner to app_definer;
revoke execute on function store_pricing_currency() from public;
grant execute on function store_pricing_currency() to app_request;

grant select, insert on product, product_option, product_option_value, product_version, product_version_option_value, version_price to app_request;
-- Never a row's store, owner or creation (§7.1): a column grant, since revoking a column under a table grant does nothing.
grant update (name, slug, description, product_type, category, visibility, approval_status, sent_back_reason, hidden_by,
  status_before_hide, publish_at, related_mode, warranty_text, returns_text, seo_title, seo_description, updated_at, revision, deleted_at)
  on product to app_request;
grant update (sku, barcode, name, visibility, hs_code, customs_description, weight_grams, length_mm, width_mm, height_mm,
  cost_amount, cost_currency, track_stock, continue_selling, position, updated_at, deleted_at) on product_version to app_request;
grant update (name, position) on product_option, product_option_value to app_request;
grant update (value_id) on product_version_option_value to app_request;
grant update (amount, compare_at_amount, source) on version_price to app_request;
grant delete on product_option, product_option_value, product_version_option_value, version_price to app_request;
grant select on price_history to app_request;
grant select, insert, update, delete on product, product_option, product_option_value, product_version, product_version_option_value, version_price, price_history to app_system;

-- Store-and-seller (§7.11): the merchant side reaches the store's rows, a supplier only its own. No
-- partner, platform or shop branch: the Shop API card adds the shop's, on visibility.
do $$
declare
  t text;
begin
  foreach t in array array['product', 'product_option', 'product_option_value', 'product_version', 'product_version_option_value', 'version_price', 'price_history'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %I on %I for all to app_request
      using (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'')
        and (app_setting_text(''app.seller_id'') = '''' or seller_id = app_setting_uuid(''app.seller_id'')))
      with check (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'')
        and (app_setting_text(''app.seller_id'') = '''' or seller_id = app_setting_uuid(''app.seller_id'')))', t || '_store', t);
    execute format('create policy %I on %I for all to app_system using (true) with check (true)', t || '_system', t);
    execute format('create policy request_scope on %I as restrictive for all to app_request
      using (app_setting_text(''app.scope'') in (''store'', ''shop'', ''partner'', ''platform''))
      with check (app_setting_text(''app.scope'') in (''store'', ''shop'', ''partner'', ''platform''))', t);
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
