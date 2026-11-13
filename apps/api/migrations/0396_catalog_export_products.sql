-- #1445: the products in a product export, beside `rows` (its versions: one spreadsheet row each); null for any other export.
alter table catalog_export add column products integer check (products >= 0);
grant update (products) on catalog_export to app_request, app_supplier;
