-- SAPI 21 (#331), part 2: the store's Activity log as CSV (LOGGING §6), one of the store's exports (0058):
-- a job read back by id, built after commit in the Owner's own scope.

alter table catalog_export drop constraint catalog_export_kind_check;
alter table catalog_export add constraint catalog_export_kind_check check (kind in ('products', 'stock', 'orders', 'customers', 'offer_codes', 'report', 'activity'));
