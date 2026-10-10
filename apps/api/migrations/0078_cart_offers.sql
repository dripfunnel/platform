-- SAPI 14 (#320), part 4: offers in the cart and at placement (OFFERS-DESIGN §3 facts 6–8, 13–16). A cart holds the codes
-- its shopper typed, never a price: the engine prices it on every read, and placement records each use in system scope.

alter table "order" add column promotion_codes text[] not null default '{}' check (cardinality(promotion_codes) <= 5);
grant select (promotion_codes) on "order" to app_shop, app_request;
grant update (promotion_codes) on "order" to app_shop;

-- The discount lines name the offer and the code they came from (fact 13); a shopper reads the line, never the ids.
alter table order_adjustment
  add column promotion_id uuid,
  add column promotion_code_id uuid,
  add constraint order_adjustment_promotion_fkey foreign key (promotion_id, store_id) references promotion (id, store_id),
  add constraint order_adjustment_promotion_code_fkey foreign key (promotion_code_id, store_id) references promotion_code (id, store_id),
  add constraint order_adjustment_promotion_kind check (promotion_id is null or kind = 'discount');
create index order_adjustment_promotion_idx on order_adjustment (promotion_id) where promotion_id is not null;
