-- #745: the partner shops address ({code}.shops.<partner domain>) and #519's per-store Cloudflare hostnames are retired; every store lives on
-- {slug}.<SHOP_DOMAIN> (#744, USERS-AND-DOMAINS §2). A partner's addresses are its portal host and its email sender.
-- Plan:
--   1. Every host #519 could have registered gets one domain.remove through the outbox: {code}.<shops host> for every store of a partner whose
--      shops address got past waiting or failed (closed stores too, whose sync already removed theirs; removing again is harmless). A host
--      Cloudflare doesn't know counts as already gone (domain.remove). Queued with a key of its own, so running again queues nothing twice.
--   2. Effects #519 queued and the relay has not delivered are deleted: their deliverers go with this build, so nothing would take them.
--   3. Every partner_domain row of kind 'shops' and its partner_domain_record rows are deleted, and the 'wildcards' rows of
--      partner_setup_item. No partner is emailed.
--   4. partner_domain.kind's check narrows to portal and email, and partner_setup_item.item's drops 'wildcards', so none can come back.
-- Between this migration and the promotion of the build that ships with it (ARCHITECTURE §6), the old build still runs.
-- The window is not harmless for the free addresses it removes, so promote straight after the migration:
--   - The old build resolves {code}.shops.<partner> through the partner's shops row, which is gone: those hosts answer 404 until
--     promotion. A store's custom domain, its {slug}.<SHOP_DOMAIN> address (built by #744, which ships with this) and every portal host
--     are not touched.
--   - The old build's Domains screen shows no Shop address and its checklist's Shop address step stays missing; adding a shops
--     address fails on the narrowed check, as a 500 rather than INVALID_INPUT.
--   - A store the old build opens in the window queues a store_host.sync that no partner's address lets it register; if the old relay
--     delivers one it registers nothing, and one that is left waits unclaimed (no deliverer after promotion) until retention.
insert into outbox (kind, idempotency_key, payload, partner_id, store_id)
select
  'domain.remove',
  'domain.remove:shops-retired:' || s.id,
  jsonb_build_object('host', lower(s.code || substr(d.host, 2))),
  s.partner_id,
  s.id
from store s
join partner_domain d on d.partner_id = s.partner_id and d.kind = 'shops' and d.status not in ('waiting', 'failed')
on conflict (idempotency_key) do nothing;
delete from outbox where kind in ('store_host.sync', 'store_hosts.register', 'store_hosts.remove') and delivered_at is null;
delete from partner_domain_record r using partner_domain d where r.domain_id = d.id and d.kind = 'shops';
delete from partner_domain where kind = 'shops';
delete from partner_setup_item where item = 'wildcards';
alter table partner_domain drop constraint partner_domain_kind_check;
alter table partner_domain add constraint partner_domain_kind_check check (kind in ('portal', 'email'));
alter table partner_setup_item drop constraint partner_setup_item_item_check;
alter table partner_setup_item
  add constraint partner_setup_item_item_check
  check (item in ('company', 'branding', 'portalHost', 'emailSender', 'plan', 'legal', 'paymentMethod', 'payoutDetails', 'testSignup'));
