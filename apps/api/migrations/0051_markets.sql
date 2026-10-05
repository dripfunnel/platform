-- SAPI 6 (#296), part 1: the store's languages, currencies and markets (DATA-MODEL §7.2; CATALOG N, O;
-- SetStore, SetMarkets). The merchant side's settings, Owner-written; a supplier reads none of them.

-- Launch languages are BCP 47 tags (CATALOG N18): en-IN, en-US, hi-IN (decided on #337). The old default 'en'
-- becomes the store's country's English.
update store set main_language = case when country = 'IN' then 'en-IN' else 'en-US' end where main_language = 'en';
alter table store alter column main_language set default 'en-US';

create function store_main_language() returns trigger
language plpgsql
as $$
begin
  if new.main_language = 'en-US' and new.country = 'IN' then
    new.main_language := 'en-IN';
  end if;
  return new;
end
$$;
create trigger store_main_language before insert on store for each row execute function store_main_language();

-- Offered on the storefront; a removed one keeps its translations, hidden (CATALOG N13).
create table store_language (
  store_id uuid not null references store (id),
  language text not null check (language ~ '^[a-z]{2,3}-[A-Z]{2}$'),
  status text not null default 'active' check (status in ('active', 'removed')),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  primary key (store_id, language)
);

-- Currencies besides the pricing currency (CATALOG facts 25–26, O): converted with a rounding, or typed by the
-- merchant. A removed one keeps its prices, unused (O9).
create table store_currency (
  store_id uuid not null references store (id),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  mode text not null check (mode in ('manual', 'convert')),
  rounding text not null default 'ends-99' check (rounding in ('none', 'nearest', 'ends-99')),
  status text not null default 'active' check (status in ('active', 'removed')),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  primary key (store_id, currency)
);

-- SetMarkets: a market sells one currency into its countries in one language, at the main address or a path
-- of the store's one domain (decided on #337). Sub-markets sit under a top-level market, within its countries.
-- "Everywhere else" is the one market marked is_fallback: kept here, so the merchant side writes no store column.
create table market (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  parent_id uuid,
  name text not null check (char_length(name) between 1 and 60),
  is_primary boolean not null default false,
  is_fallback boolean not null default false,
  -- jsonb, not text[]: the Worker's client reads arrays as text (docs/api/README.md §7).
  countries jsonb not null default '[]' check (jsonb_typeof(countries) = 'array'),
  currency char(3) not null,
  language text not null,
  price_adjustment_bps integer not null default 0 check (price_adjustment_bps between -9000 and 100000),
  web_mode text not null default 'main' check (web_mode in ('main', 'path')),
  path_prefix text check (path_prefix ~ '^[a-z0-9][a-z0-9-]{0,19}$'),
  products text not null default 'all' check (products in ('all', 'some')),
  duties_mode text not null default 'none' check (duties_mode in ('none', 'by_code', 'flat')),
  duties_rate_bps integer check (duties_rate_bps between 1 and 10000),
  duties_threshold_amount bigint check (duties_threshold_amount >= 0),
  status text not null default 'active' check (status in ('active', 'inactive')),
  position integer not null default 0 check (position >= 0),
  revision integer not null default 1,
  created_at timestamptz not null default date_trunc('milliseconds', now()),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (parent_id) references market (id),
  constraint market_path check ((web_mode = 'path') = (path_prefix is not null)),
  constraint market_flat_duties check ((duties_mode = 'flat') = (duties_rate_bps is not null)),
  constraint market_primary_sells check (not is_primary or (status = 'active' and parent_id is null)),
  constraint market_fallback_top check (not is_fallback or parent_id is null)
);

create unique index market_id_store_key on market (id, store_id);
create unique index market_primary_key on market (store_id) where is_primary and deleted_at is null;
create unique index market_fallback_key on market (store_id) where is_fallback and deleted_at is null;
create unique index market_path_key on market (store_id, path_prefix) where path_prefix is not null and deleted_at is null;
create unique index market_name_key on market (store_id, lower(name)) where deleted_at is null;
create index market_store_idx on market (store_id, position, created_at, id) where deleted_at is null;

-- A country is in at most one top-level market; a sub-market's countries are its parent's, and siblings never
-- share one, so every country resolves to one market (DATA-MODEL §7.2). Sub-markets go one level deep.
create function market_countries_check() returns trigger
language plpgsql
as $$
declare
  parent record;
begin
  if new.deleted_at is not null then
    return new;
  end if;
  if new.parent_id is not null then
    select parent_id, countries, deleted_at into parent from market where id = new.parent_id and store_id = new.store_id;
    if not found or parent.deleted_at is not null or parent.parent_id is not null then
      raise exception 'market: a sub-market sits under one of the store''s top-level markets' using errcode = '23514';
    end if;
    if not (parent.countries @> new.countries) then
      raise exception 'market: a sub-market''s countries are its parent''s' using errcode = '23514';
    end if;
  end if;
  if exists (
    select 1 from market m
    where m.store_id = new.store_id and m.id <> new.id and m.deleted_at is null
      and m.parent_id is not distinct from new.parent_id and m.countries ?| array(select jsonb_array_elements_text(new.countries))
  ) then
    raise exception 'market: a country is in one market only' using errcode = '23505';
  end if;
  return new;
end
$$;
create trigger market_countries_check before insert or update on market for each row execute function market_countries_check();

create table market_excluded_product (
  market_id uuid not null,
  product_id uuid not null,
  store_id uuid not null,
  primary key (market_id, product_id),
  foreign key (market_id, store_id) references market (id, store_id) on delete cascade,
  foreign key (product_id, store_id) references product (id, store_id)
);

-- Every store sells first where it is: its main language, and a primary "Home" market in its country and pricing
-- currency, made with the store as its default warehouse is (0046).
create function store_default_market() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into store_language (store_id, language) values (new.id, new.main_language);
  insert into market (store_id, name, is_primary, countries, currency, language)
  values (new.id, 'Home', true, case when new.country is null then '[]'::jsonb else jsonb_build_array(new.country) end, coalesce(new.pricing_currency, 'USD'), new.main_language);
  return new;
end
$$;
grant insert on store_language, market to app_definer;
grant select (id, store_id, parent_id, countries, deleted_at) on market to app_definer;
alter function store_default_market() owner to app_definer;
create trigger store_default_market after insert on store for each row execute function store_default_market();

-- Markets selling in the pricing currency follow it when it changes (it is locked once the first order exists).
create function store_markets_follow_currency() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update market set currency = new.pricing_currency, revision = revision + 1, updated_at = now()
  where store_id = new.id and deleted_at is null and (currency = old.pricing_currency or (old.pricing_currency is null and is_primary));
  return new;
end
$$;
grant update (currency, revision, updated_at) on market to app_definer;
grant select (currency, is_primary, revision) on market to app_definer;
alter function store_markets_follow_currency() owner to app_definer;
create trigger store_markets_follow_currency after update of pricing_currency on store
for each row when (new.pricing_currency is distinct from old.pricing_currency and new.pricing_currency is not null)
execute function store_markets_follow_currency();

insert into store_language (store_id, language) select s.id, s.main_language from store s;
insert into market (store_id, name, is_primary, countries, currency, language)
select s.id, 'Home', true, case when s.country is null then '[]'::jsonb else jsonb_build_array(s.country) end, coalesce(s.pricing_currency, 'USD'), s.main_language from store s;

-- The main language is a store column, which the merchant side writes by no policy: this one, through here.
create function set_store_main_language(language text) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if app_setting_text('app.scope') <> 'store' or app_setting_text('app.seller_id') <> '' or app_setting_text('app.support') = 'read' then
    raise exception 'set_store_main_language: the merchant side of a store only' using errcode = '42501';
  end if;
  if not exists (select 1 from store_language l where l.store_id = app_setting_uuid('app.store_id') and l.language = set_store_main_language.language and l.status = 'active') then
    raise exception 'set_store_main_language: one of the store''s languages' using errcode = '23514';
  end if;
  update store set main_language = set_store_main_language.language where id = app_setting_uuid('app.store_id');
end
$$;
grant select on store_language to app_definer;
grant update (main_language) on store to app_definer;
alter function set_store_main_language(text) owner to app_definer;
revoke execute on function set_store_main_language(text) from public;
grant execute on function set_store_main_language(text) to app_request;

grant select, insert, update on store_language, store_currency, market to app_request;
grant select, insert, delete on market_excluded_product to app_request;
grant select, insert, update, delete on store_language, store_currency, market, market_excluded_product to app_system;

do $$
declare
  t text;
begin
  foreach t in array array['store_language', 'store_currency', 'market', 'market_excluded_product'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %I on %I for all to app_system using (true) with check (true)', t || '_system', t);
    execute format('create policy %I on %I for all to app_request
      using (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'') and app_setting_text(''app.seller_id'') = '''')
      with check (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'') and app_setting_text(''app.seller_id'') = '''')', t || '_merchant', t);
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
