-- Admin sets a partner's contract (admin FIRST-RELEASE §4.3): a currency the partner may price in
-- without a conversion rate has a row with no rate, and staff can take a currency off again.
alter table partner_contract_rate alter column per_fee_unit drop not null;
grant delete on partner_contract_rate to app_platform;
