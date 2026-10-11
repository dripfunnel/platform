-- INF 5 (#484): the post-deploy checks from the edge and the automatic rollback (storefront LIVE-SHOP.md §4 step 10,
-- ARCHITECTURE §4.2 steps 5–6). Nothing here is destructive: new nullable columns only.

alter table publish_run
  -- When the pointer moved to this build; the run stays deploying until its checks pass (SAAS §9.1).
  add column switched_at timestamptz,
  -- Each post-deploy check's name, passed, failed or skipped, and plain words; never a page's content.
  add column checks jsonb check (checks is null or jsonb_typeof(checks) = 'array'),
  -- When the pointer moved back to previous_build_id; error says why.
  add column rolled_back_at timestamptz,
  add constraint publish_run_rolled_back check ((state = 'rolled_back') = (rolled_back_at is not null)),
  add constraint publish_run_rolled_back_after_switch check (rolled_back_at is null or switched_at is not null);

-- Builds that went live before this card switched when they finished.
update publish_run set switched_at = finished_at where state = 'live' and switched_at is null;
