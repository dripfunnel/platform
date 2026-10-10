-- SAPI 19 (#329), part 2: Choose what to keep (SAAS §6.2, PortalKeep) and closing the store (SAAS §4.2).

-- The Owner's picks of products to keep on a smaller plan, held until it takes effect; null when none were made.
alter table store_subscription add column keep_products uuid[] check (cardinality(keep_products) <= 10000);
grant select (keep_products) on store_subscription to app_request;

-- The trial sweep finds trials that ended (store_trial_ends_idx covers the store's mirror).
create index store_subscription_trial_idx on store_subscription (trial_ends_at) where status = 'trial';
