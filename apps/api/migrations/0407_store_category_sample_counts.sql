-- The sample editor (admin FIRST-RELEASE §11b): staff add and remove sample products and collections, so a sample holds
-- 1 to 10 collections rather than exactly 2 (DATA-MODEL §7.2). Widens 0404's check only.
alter table store_category_sample drop constraint store_category_sample_collections_check;
alter table store_category_sample add constraint store_category_sample_collections_check
  check (jsonb_typeof(collections) = 'array' and jsonb_array_length(collections) between 1 and 10);
