-- SAPI 11 (#310), part 4: orders exported as the store's other exports are (0058): a job read back by id, built in the
-- asker's own scope, so a supplier's file holds only its own lines.

alter table catalog_export drop constraint catalog_export_kind_check;
alter table catalog_export add constraint catalog_export_kind_check check (kind in ('products', 'stock', 'orders'));
