-- SAPI 14 (#320), part 3: an offer's single-use codes exported as the store's other exports are (0058, 0073, 0074): a job
-- read back by id, built in the asker's own scope. Never a supplier's: no supplier role holds offers.export.

alter table catalog_export drop constraint catalog_export_kind_check;
alter table catalog_export add constraint catalog_export_kind_check check (kind in ('products', 'stock', 'orders', 'customers', 'offer_codes'));
