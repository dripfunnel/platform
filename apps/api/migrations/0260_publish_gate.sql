-- INF 4 (#483): the publish gate's build (storefront LIVE-SHOP.md §4 steps 3–7; DATA-MODEL §7.8). Nothing here is
-- destructive: two new nullable columns.

alter table publish_run
  -- When the platform started the store repo's workflow for this build (LIVE-SHOP §4 step 4).
  add column dispatched_at timestamptz,
  -- From the dispatch to the report, rounded up: the build's GitHub Actions time (SAAS §12, the platform's cost).
  add column build_minutes integer check (build_minutes >= 0);
