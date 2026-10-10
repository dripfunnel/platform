-- SAPI 18 (#322), part 3: Reports' exports and the custom report builder, as the store's other exports are (0058): a job
-- read back by id, built after commit in the asker's own scope.

alter table catalog_export drop constraint catalog_export_kind_check;
alter table catalog_export add constraint catalog_export_kind_check check (kind in ('products', 'stock', 'orders', 'customers', 'report'));
