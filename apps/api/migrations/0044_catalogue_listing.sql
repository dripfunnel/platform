-- SAPI 3, part 4 (#293): Settings › Catalogue (store_feature, badge) and a product's listing sections,
-- DATA-MODEL §7.2–7.3: specifications, highlights, FAQs, related products, manual badges, flags,
-- compliance, where it sells, and size charts. Classes as §7.11 names them.

create table store_feature (
  store_id uuid not null references store (id),
  key text not null check (key in ('sizeCharts', 'specs', 'highlights', 'faqs', 'badges', 'related', 'aplus', 'video')),
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (store_id, key)
);

-- CATALOG S5: a label of up to 18 characters, a tone from the prototype's set, and one rule.
create table badge (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  label text not null check (char_length(label) between 1 and 18),
  tone text not null check (tone in ('ok', 'peach', 'neutral')),
  rule text not null check (rule in ('new_30_days', 'top_5_this_month', 'below_compare_price', 'few_left', 'manual')),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now()
);

create unique index badge_id_store_key on badge (id, store_id);
create unique index badge_label_key on badge (store_id, lower(label));

create table size_chart (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  -- A supplier's own chart, seen only by it and the merchant (CATALOG R13).
  seller_id uuid,
  name text not null check (char_length(name) between 1 and 80),
  unit text not null check (unit in ('cm', 'in')),
  -- jsonb, not text[]: the Worker's client reads arrays as text (docs/api/README.md §7).
  systems jsonb not null default '[]',
  measurements jsonb not null default '[]',
  rows jsonb not null default '[]',
  how_to_measure jsonb not null default '[]',
  fit_notes text check (char_length(fit_notes) <= 500),
  model_info text check (char_length(model_info) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  deleted_at timestamptz,
  foreign key (seller_id, store_id) references seller (id, store_id)
);

create unique index size_chart_id_store_key on size_chart (id, store_id);
create index size_chart_list_idx on size_chart (store_id, seller_id, updated_at desc, id desc) where deleted_at is null;

alter table product add column size_chart_id uuid;
alter table product add foreign key (size_chart_id, store_id) references size_chart (id, store_id);
grant update (size_chart_id) on product to app_request;

-- A product's chart is its own owner's, so a supplier never holds a chart it can't read (R13).
create function product_size_chart_check() returns trigger
language plpgsql
as $$
begin
  if new.size_chart_id is not null and not exists (
    select 1 from size_chart c where c.id = new.size_chart_id and c.store_id = new.store_id and c.deleted_at is null
      and c.seller_id is not distinct from new.seller_id
  ) then
    raise exception 'catalogue: no such size chart for this product' using errcode = '23503';
  end if;
  return new;
end
$$;

create trigger product_size_chart_check before insert or update of size_chart_id on product for each row execute function product_size_chart_check();

create table product_spec (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null,
  version_id uuid,
  store_id uuid not null,
  seller_id uuid,
  name text not null check (char_length(name) between 1 and 60),
  value text not null check (char_length(value) between 1 and 200),
  -- "Shoppers can filter by this" (fact 30): the row mirrors the filter value it points at.
  filter_value_id uuid,
  position integer not null check (position >= 0),
  foreign key (product_id, store_id) references product (id, store_id),
  foreign key (version_id, store_id) references product_version (id, store_id),
  -- Only the link clears when its value goes: the store column of a composite key must stay.
  foreign key (filter_value_id, store_id) references filter_value (id, store_id) on delete set null (filter_value_id)
);

create table product_highlight (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null,
  store_id uuid not null,
  seller_id uuid,
  text text not null check (char_length(text) between 1 and 120),
  position integer not null check (position >= 0),
  foreign key (product_id, store_id) references product (id, store_id)
);

create table product_faq (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null,
  store_id uuid not null,
  seller_id uuid,
  question text not null check (char_length(question) between 1 and 200),
  answer text not null check (char_length(answer) between 1 and 2000),
  position integer not null check (position >= 0),
  foreign key (product_id, store_id) references product (id, store_id)
);

create table product_related (
  product_id uuid not null,
  related_product_id uuid not null,
  store_id uuid not null,
  seller_id uuid,
  position integer not null check (position >= 0),
  primary key (product_id, related_product_id),
  foreign key (product_id, store_id) references product (id, store_id),
  foreign key (related_product_id, store_id) references product (id, store_id),
  check (product_id <> related_product_id)
);

create table product_badge (
  product_id uuid not null,
  badge_id uuid not null,
  store_id uuid not null,
  seller_id uuid,
  primary key (product_id, badge_id),
  foreign key (product_id, store_id) references product (id, store_id),
  foreign key (badge_id, store_id) references badge (id, store_id) on delete cascade
);

create table product_flag (
  product_id uuid primary key,
  store_id uuid not null,
  seller_id uuid,
  -- Alcohol is sold with an age check (decided on #337).
  age_restricted boolean not null default false,
  hazardous boolean not null default false,
  foreign key (product_id, store_id) references product (id, store_id)
);

create table product_compliance (
  product_id uuid not null,
  store_id uuid not null,
  seller_id uuid,
  region text not null check (region ~ '^([A-Z]{2}|EU|ALL)$'),
  field text not null check (field ~ '^[a-z][a-z0-9_]{1,40}$'),
  value text not null check (char_length(value) between 1 and 2000),
  primary key (product_id, region, field),
  foreign key (product_id, store_id) references product (id, store_id)
);

-- "Where you sell" per product (fact 42); jsonb countries, as size_chart's lists.
create table product_market_rule (
  product_id uuid primary key,
  store_id uuid not null,
  seller_id uuid,
  mode text not null check (mode in ('only', 'except')),
  countries jsonb not null,
  foreign key (product_id, store_id) references product (id, store_id)
);

-- A related product and a manual badge are this store's; a supplier relates only its own products (S6).
create function product_related_check() returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from product p where p.id = new.related_product_id and p.store_id = new.store_id and p.deleted_at is null) then
    raise exception 'catalogue: no such product to relate' using errcode = '23503';
  end if;
  return new;
end
$$;

create function product_badge_check() returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from badge b where b.id = new.badge_id and b.store_id = new.store_id and b.rule = 'manual') then
    raise exception 'catalogue: only a manual badge is picked on a product' using errcode = '23514';
  end if;
  return new;
end
$$;

do $$
declare
  t text;
begin
  foreach t in array array['product_spec', 'product_highlight', 'product_faq', 'product_related', 'product_badge', 'product_flag', 'product_compliance', 'product_market_rule'] loop
    execute format('create trigger %I before insert or update on %I for each row execute function catalogue_owner_from_product()', t || '_owner', t);
  end loop;
end
$$;

create trigger product_related_zcheck before insert or update on product_related for each row execute function product_related_check();
create trigger product_badge_zcheck before insert or update on product_badge for each row execute function product_badge_check();

grant select, insert, update, delete on store_feature, badge to app_request;
grant select, insert, update, delete on size_chart to app_request;
revoke update on size_chart from app_request;
grant update (name, unit, systems, measurements, rows, how_to_measure, fit_notes, model_info, updated_at, revision, deleted_at) on size_chart to app_request;
grant select, insert, delete on product_spec, product_highlight, product_faq, product_related, product_badge, product_flag, product_compliance, product_market_rule to app_request;
grant update (age_restricted, hazardous) on product_flag to app_request;
grant select, insert, update, delete on store_feature, badge, size_chart, product_spec, product_highlight, product_faq, product_related, product_badge, product_flag, product_compliance, product_market_rule to app_system;

do $$
declare
  t text;
begin
  foreach t in array array['store_feature', 'badge', 'size_chart', 'product_spec', 'product_highlight', 'product_faq', 'product_related', 'product_badge', 'product_flag', 'product_compliance', 'product_market_rule'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
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

  -- Settings: the merchant side writes; a supplier reads which sections and manual badges exist (§7.11).
  foreach t in array array['store_feature', 'badge'] loop
    execute format('create policy %I on %I for all to app_request
      using (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'') and app_setting_text(''app.seller_id'') = '''')
      with check (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'') and app_setting_text(''app.seller_id'') = '''')', t || '_merchant', t);
    execute format('create policy %I on %I for select to app_request
      using (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id''))', t || '_supplier_read', t);
  end loop;

  -- Store-and-seller: the merchant side reaches the store's rows, a supplier its own only.
  foreach t in array array['size_chart', 'product_spec', 'product_highlight', 'product_faq', 'product_related', 'product_badge', 'product_flag', 'product_compliance', 'product_market_rule'] loop
    execute format('create policy %I on %I for all to app_request
      using (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'')
        and (app_setting_text(''app.seller_id'') = '''' or seller_id = app_setting_uuid(''app.seller_id'')))
      with check (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'')
        and (app_setting_text(''app.seller_id'') = '''' or seller_id = app_setting_uuid(''app.seller_id'')))', t || '_store', t);
  end loop;
end
$$;

-- A supplier's chart is its own: it can't make one in the merchant's name or another supplier's.
create function size_chart_owner_check() returns trigger
language plpgsql
as $$
begin
  if app_setting_text('app.seller_id') <> '' and new.seller_id is distinct from app_setting_uuid('app.seller_id') then
    raise exception 'catalogue: a supplier makes its own size charts' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger size_chart_owner_check before insert on size_chart for each row execute function size_chart_owner_check();
