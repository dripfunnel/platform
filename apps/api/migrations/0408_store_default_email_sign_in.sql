-- #1492: every new store starts with Email and password, whatever its country (DATA-MODEL §3.4); the merchant can add
-- the mobile number later. Only the trigger changes: a store that already has a row keeps its own choice.
create or replace function store_default_customer_auth() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into store_customer_auth (store_id, email_enabled, phone_enabled) values (new.id, true, false);
  return new;
end
$$;
