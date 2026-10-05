-- SAPI 5 (#295): supplier users get their own database role (DATA-MODEL §5.3). They held app_request
-- until now, kept to their rows by policy alone; app_supplier holds grants only on what a supplier
-- reaches, so every other table refuses it before any policy runs.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_supplier') then
    create role app_supplier nologin;
  end if;
end
$$;

-- Whoever may become app_request (the Worker's login) may become app_supplier, as 0010 did for staff.
do $$
declare
  login text;
begin
  for login in
    select m.member::regrole::text from pg_auth_members m where m.roleid = 'app_request'::regrole
  loop
    execute format('grant app_supplier to %s', login);
  end loop;
end
$$;

grant usage on schema public to app_supplier;

-- The tables a supplier reaches (ACCESS §5.2, §7): its catalogue and stock, the settings it reads, its
-- own seller and team, and the log and outbox every write records in. app_request's grants on them are
-- copied as they stand, column by column where they are by column, and their policies extended.
do $$
declare
  t text;
  g record;
  p record;
  supplier_tables text[] := array[
    'product', 'product_option', 'product_option_value', 'product_version', 'product_version_option_value',
    'version_price', 'price_history', 'asset', 'product_photo', 'product_video',
    'filter', 'filter_value', 'product_filter_value', 'store_feature', 'badge', 'size_chart',
    'product_spec', 'product_highlight', 'product_faq', 'product_related', 'product_badge', 'product_flag',
    'product_compliance', 'product_market_rule', 'product_story',
    'warehouse', 'stock_level', 'stock_movement',
    'seller', 'membership', 'user', 'invitation',
    'activity_log', 'outbox'
  ];
begin
  foreach t in array supplier_tables loop
    for g in
      select privilege_type from information_schema.role_table_grants
      where grantee = 'app_request' and table_schema = 'public' and table_name = t
    loop
      execute format('grant %s on %I to app_supplier', g.privilege_type, t);
    end loop;
    -- Column grants where the table grant isn't held (update by column, credential columns withheld).
    for g in
      select c.privilege_type, string_agg(format('%I', c.column_name), ', ') as columns
      from information_schema.column_privileges c
      where c.grantee = 'app_request' and c.table_schema = 'public' and c.table_name = t
        and not exists (
          select 1 from information_schema.role_table_grants r
          where r.grantee = 'app_request' and r.table_schema = 'public' and r.table_name = t and r.privilege_type = c.privilege_type
        )
      group by c.privilege_type
    loop
      execute format('grant %s (%s) on %I to app_supplier', g.privilege_type, g.columns, t);
    end loop;
    for p in
      select policyname, roles from pg_policies where schemaname = 'public' and tablename = t and 'app_request' = any (roles)
    loop
      execute format('alter policy %I on %I to %s', p.policyname, t,
        (select string_agg(format('%I', r), ', ') from unnest(array_append(p.roles::text[], 'app_supplier')) r));
    end loop;
  end loop;
end
$$;

-- The log's, seller's and membership's policies name store(id, partner_id) in their partner branches, and
-- Postgres checks a policy's tables whatever branch applies. No store policy names app_supplier, so it
-- still reads no store row (0003 store_read).
grant select (id, partner_id) on store to app_supplier;

-- 0045's file checks ask whether a brand story shows a file; a supplier holds no brand story rows (no
-- policy names it), so it reads only these columns and finds none.
grant select (id, asset_ids) on story_block to app_supplier;

-- 0045's story check, with every brand-story step inside "the story names one", which a supplier's never does.
create or replace function product_story_check() returns trigger
language plpgsql
as $$
declare
  doc jsonb := new.draft || coalesce(new.live, '[]');
  videos uuid[];
  added uuid[];
begin
  new.asset_ids := array(select distinct (v #>> '{}')::uuid from jsonb_path_query(doc, 'lax $.**.assetId') v where jsonb_typeof(v) = 'string');
  new.product_ids := array(select distinct (v #>> '{}')::uuid from jsonb_path_query(doc, 'lax $[*].productIds[*]') v);
  new.block_ids := array(select distinct (v #>> '{}')::uuid from jsonb_path_query(doc, 'lax $[*].blockId') v where jsonb_typeof(v) = 'string');
  videos := array(select distinct (v #>> '{}')::uuid from jsonb_path_query(doc, 'lax $[*] ? (@.kind == "video").video.assetId') v where jsonb_typeof(v) = 'string');

  if (select count(*) from asset a where a.id = any (new.asset_ids) and a.store_id = new.store_id
        and a.kind = case when a.id = any (videos) then 'video' else 'image' end) <> cardinality(new.asset_ids) then
    raise exception 'catalogue: a story names a file that isn''t here or is the wrong kind' using errcode = '23503';
  end if;
  -- Only a product the save adds is checked, so trashing a compared product never blocks the story's next save.
  added := array(select unnest(new.product_ids) except select unnest(case when tg_op = 'UPDATE' then old.product_ids else '{}' end));
  if new.product_id = any (new.product_ids)
     or (select count(*) from product p where p.id = any (added) and p.store_id = new.store_id and p.deleted_at is null
           and (new.seller_id is null or p.seller_id is not distinct from new.seller_id)) <> cardinality(added) then
    raise exception 'catalogue: a story compares a product it can''t' using errcode = '23503';
  end if;
  -- A brand story is the merchant's, so only the merchant's products carry one (Q5). The share lock waits
  -- out a delete of the block; a story naming none never reads story_block, which a supplier holds no rows of.
  if cardinality(new.block_ids) > 0 then
    if new.seller_id is not null then
      raise exception 'catalogue: a story names a brand story it can''t' using errcode = '23503';
    end if;
    perform 1 from story_block b where b.id = any (new.block_ids) and b.store_id = new.store_id for share;
    if (select count(*) from story_block b where b.id = any (new.block_ids) and b.store_id = new.store_id) <> cardinality(new.block_ids) then
      raise exception 'catalogue: a story names a brand story it can''t' using errcode = '23503';
    end if;
  end if;
  perform catalogue_claim_assets(new.store_id, new.seller_id, new.asset_ids, new.product_id, null);
  return new;
end
$$;

-- The definer functions a supplier's own work calls (DATA-MODEL §5.3's app_definer row).
grant execute on function store_product_count() to app_supplier;
grant execute on function store_pricing_currency() to app_supplier;
grant execute on function stock_change(uuid, uuid, integer, integer, text, out integer, out integer) to app_supplier;
grant execute on function stock_change_many(jsonb, text) to app_supplier;
-- Every person in the store sees an open support session's banner (0036), a supplier too.
grant execute on function open_support_banner(timestamptz) to app_supplier;
