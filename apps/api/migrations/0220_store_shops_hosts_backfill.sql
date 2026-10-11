-- #519: the one-off backfill of SAAS §5 step 3 for stores made before it. Every open store under a live shops
-- address gets the `store_host.sync` its address's fan-out would queue, with the same key (saas/domains/storeHosts.ts),
-- so running it again, or the fan-out after it, queues nothing twice. The relay registers each host after deploy.
insert into outbox (kind, idempotency_key, payload, partner_id, store_id)
select
  'store_host.sync',
  'store_host.sync:' || s.partner_id || ':' || s.id || ':' || d.id,
  jsonb_build_object('partnerId', s.partner_id, 'storeId', s.id),
  s.partner_id,
  s.id
from store s
join partner_domain d on d.partner_id = s.partner_id and d.kind = 'shops' and d.status = 'live'
where s.status <> 'closed'
on conflict (idempotency_key) do nothing;
