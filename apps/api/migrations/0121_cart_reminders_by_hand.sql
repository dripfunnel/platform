-- SAPI 15 (#321), part 2: a reminder sent by hand carries the discount its sender chose ("Remind now", Carts); one from a
-- step takes the step's.
alter table cart_reminder add column discount_bps integer check (discount_bps between 100 and 5000);
grant select (discount_bps) on cart_reminder to app_request;
