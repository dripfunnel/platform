-- SAPI 18 (#322), part 1: Home's figures (FIRST-RELEASE §5) read a store's placed orders by the day they were placed,
-- and its latest orders newest first; the store-and-state index (0066) orders by update, not placement.

create index order_store_placed_idx on "order" (store_id, placed_at desc) where state <> 'cart';
