-- Publishing branding (#162) keeps the partner row's "Powered by" equal to the live version, as
-- it already does the product name and colours (0011's column grants; DATA-MODEL §2.5).
grant update (powered_by) on partner to app_partner;

-- The contract decides (0013): a partner never sets 'house' or leaves it, and turns "Powered by"
-- off only when its contract lets plans remove it. Not a definer: it tests the writer's role,
-- and a partner reads its own contract.
create function partner_powered_by_guard() returns trigger
language plpgsql
as $$
begin
  if current_user = 'app_partner' and new.powered_by is distinct from old.powered_by and (
    'house' in (new.powered_by, old.powered_by)
    or (new.powered_by = 'off' and not coalesce((select powered_by_removable from partner_contract where partner_id = new.id), false))
  ) then
    raise exception 'partner: "Powered by" is fixed by the contract' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

create trigger partner_powered_by_guard before update of powered_by on partner
for each row execute function partner_powered_by_guard();
