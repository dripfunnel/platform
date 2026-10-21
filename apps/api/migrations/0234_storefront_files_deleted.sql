-- INF 2 (#317), part 2: when clean-up deleted a closed store's files in the three storefront buckets (storefront LIVE-SHOP.md
-- §4 step 11, SAAS §4.2's 90 days), so it does it once. A new, empty column.
alter table storefront add column files_deleted_at timestamptz;
