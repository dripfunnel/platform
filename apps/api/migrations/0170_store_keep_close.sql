-- SAPI 19 (#329), part 2: Choose what to keep (SAAS §6.2, PortalKeep) and closing the store (SAAS §4.2).

-- The Owner's picks of products to keep on a smaller plan, held until it takes effect; null when none were made.
alter table store_subscription add column keep_products uuid[] check (cardinality(keep_products) <= 10000);
grant select (keep_products) on store_subscription to app_request;

-- "Download my data first" (FIRST-RELEASE §16): its parts are the store's own exports, read back together by the bundle.
alter table catalog_export add column bundle uuid;
create index catalog_export_bundle_idx on catalog_export (store_id, bundle) where bundle is not null;

-- The trial sweep finds trials that ended (store_trial_ends_idx covers the store's mirror).
create index store_subscription_trial_idx on store_subscription (trial_ends_at) where status = 'trial';
