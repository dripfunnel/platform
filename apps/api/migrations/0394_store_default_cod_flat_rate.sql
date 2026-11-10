-- New stores start able to take an order: Cash on delivery live where it is offered (checkout/providers.ts) and a flat
-- delivery rate of 0, saved, so checkout quotes it at once (SAAS §5 step 2). A merchant's own choice is never overwritten.
create function store_default_checkout() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.country = 'IN' then
    insert into payment_provider_account (store_id, provider, status) values (new.id, 'cod', 'live');
  end if;
  if new.pricing_currency is not null then
    insert into store_shipping (store_id, flat_enabled, flat_amount, currency, saved_at, revision)
    values (new.id, true, 0, new.pricing_currency, now(), 1);
  end if;
  return new;
end
$$;

grant insert on payment_provider_account, store_shipping to app_definer;
alter function store_default_checkout() owner to app_definer;
create trigger store_default_checkout after insert on store for each row execute function store_default_checkout();

-- Stores that already exist and still sell get the same where the merchant has not chosen.
insert into payment_provider_account (store_id, provider, status)
select s.id, 'cod', 'live' from store s where s.country = 'IN' and s.status <> 'closed'
on conflict do nothing;

insert into store_shipping (store_id, flat_enabled, flat_amount, currency, saved_at, revision)
select s.id, true, 0, s.pricing_currency, now(), 1 from store s where s.pricing_currency is not null and s.status <> 'closed'
on conflict do nothing;
