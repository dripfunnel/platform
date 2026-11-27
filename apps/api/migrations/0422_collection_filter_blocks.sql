-- A collection's products come from blocks joined by AND / OR (#1558, DATA-MODEL §7.3): a block is a
-- collection_rule row, picked products one more kind of it. The collection-wide `match` and the manual /
-- automatic split no longer decide what a collection holds; `kind` now only says whether it is picks alone.

alter table collection_rule add column if not exists joiner text not null default 'and' check (joiner in ('and', 'or'));
alter table collection_rule drop constraint if exists collection_rule_kind_check;
alter table collection_rule add constraint collection_rule_kind_check
  check (kind in ('filter_value', 'name_contains', 'product', 'version', 'price_range', 'picks'));

-- A hand-picked collection becomes one Pick products block, in its order.
insert into collection_rule (collection_id, store_id, kind, args, position, joiner)
select c.id, c.store_id, 'picks',
  jsonb_build_object('productIds', (select jsonb_agg(cp.product_id order by cp.position) from collection_product cp where cp.collection_id = c.id)),
  0, 'and'
from collection c
where c.kind = 'manual'
  and exists (select 1 from collection_product cp where cp.collection_id = c.id)
  and not exists (select 1 from collection_rule r where r.collection_id = c.id and r.kind = 'picks');

-- "Match any": every rule alternative to the one before it.
update collection_rule r set joiner = 'or'
from collection c
where c.id = r.collection_id and c.kind = 'automatic' and c.match = 'any' and r.position > 0;

-- "Match all": the values of one filter were alternatives, so they become one block of "any of these".
with grouped as (
  select r.collection_id, fv.filter_id, min(r.position) as keep_position, jsonb_agg(r.args->>'valueId' order by r.position) as ids
  from collection_rule r
  join collection c on c.id = r.collection_id and c.kind = 'automatic' and c.match = 'all'
  join filter_value fv on fv.id = (r.args->>'valueId')::uuid
  where r.kind = 'filter_value' and r.args ? 'valueId'
  group by r.collection_id, fv.filter_id
), kept as (
  update collection_rule r set args = jsonb_build_object('valueIds', g.ids, 'match', 'any')
  from grouped g, filter_value fv
  where r.collection_id = g.collection_id and r.kind = 'filter_value' and r.position = g.keep_position
    and r.args ? 'valueId' and fv.id = (r.args->>'valueId')::uuid and fv.filter_id = g.filter_id
  returning r.id
)
delete from collection_rule r
using collection c
where c.id = r.collection_id and c.kind = 'automatic' and c.match = 'all'
  and r.kind = 'filter_value' and r.args ? 'valueId'
  and exists (select 1 from filter_value fv where fv.id = (r.args->>'valueId')::uuid)
  and r.id not in (select id from kept);

-- Every other filter-value rule is a block of one value.
update collection_rule set args = jsonb_build_object('valueIds', jsonb_build_array(args->>'valueId'), 'match', 'any')
where kind = 'filter_value' and args ? 'valueId';
