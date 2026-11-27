-- #1759: an invoice for each Razorpay plan payment, Razorpay's own in the partner's name (SAAS §7.4; DATA-MODEL §7.9).
-- Additive: the previous release only ever writes Stripe rows, which still carry stripe_invoice_id.

alter table invoice
  alter column stripe_invoice_id drop not null,
  add column razorpay_invoice_id text unique check (razorpay_invoice_id ~ '^inv_[A-Za-z0-9]+$'),
  add column invoice_url text check (invoice_url ~ '^https://' and char_length(invoice_url) <= 500),
  add constraint invoice_one_provider check ((stripe_invoice_id is null) <> (razorpay_invoice_id is null));
