-- #1178: a Shopify import may carry Shopify's inventory file (CATALOG-DESIGN K1, K5). It is kept until the check has
-- read it; the warehouse each Shopify location was matched to on the confirm step is kept for the run.
-- Backward-compatible: both columns are nullable and unread by the previous release.
alter table catalog_import add column inventory text;
alter table catalog_import add column warehouse_map jsonb;

grant update (inventory, warehouse_map) on catalog_import to app_request, app_supplier;
