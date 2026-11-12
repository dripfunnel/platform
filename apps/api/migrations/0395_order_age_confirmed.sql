-- #1443: when the shopper confirmed they are 18 or over at Review, for an order with an age-restricted product; null otherwise.
alter table "order" add column age_confirmed_at timestamptz;
