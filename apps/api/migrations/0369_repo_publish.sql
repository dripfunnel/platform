-- #968: a push to a store repo's `main` builds and goes live as a publish of its own kind (storefront LIVE-SHOP.md §4).
-- Widening the check only: the previous release never writes 'repo'.
alter table publish_run drop constraint publish_run_kind_check;
alter table publish_run add constraint publish_run_kind_check
  check (kind in ('manual', 'automatic', 'staff', 'design', 'page', 'upgrade', 'security', 'rollback', 'repo'));
