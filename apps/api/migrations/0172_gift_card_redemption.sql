-- SAPI 22 (#323), part 3: a gift card's balance and its redemption at checkout (FIRST-RELEASE §19), and the merchant's
-- cards issued (CatEditor). Every balance change is the engine's, in system scope, under the card's row lock.

-- The card a cart holds, put there by the engine once its code checked out; what placement took from it.
alter table "order"
  add column gift_card_id uuid references gift_card (id),
  add column gift_card_amount bigint not null default 0 check (gift_card_amount >= 0),
  drop constraint order_payment_method_check,
  add constraint order_payment_method_check check (payment_method in ('stripe', 'paypal', 'razorpay', 'cashfree', 'phonepe', 'cod', 'bank_transfer', 'gift_card'));
create index order_gift_card_idx on "order" (gift_card_id) where gift_card_id is not null;
-- Read as any order column is; never written by a shopper (DATA-MODEL §5.3: placement is the engine's).
grant select (gift_card_id, gift_card_amount) on "order" to app_request, app_shop;

-- Cards issued: the merchant side reads every card but its code's hash (CatEditor shows the last four).
grant select (id, store_id, product_id, code_last4, currency, initial_amount, balance_amount, expiry_months, expires_at, recipient_name,
  recipient_email, message, send_on, sent_at, order_line_id, issued_by, status, created_at, updated_at) on gift_card to app_request;
create policy gift_card_merchant on gift_card for select to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '');

-- "Issue a card" names its request once, so a double click or a retry after a timeout issues one card, not two.
alter table gift_card add column issue_key uuid;
create unique index gift_card_issue_key on gift_card (store_id, issue_key) where issue_key is not null;
