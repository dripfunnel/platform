-- Settings › People (#290, ACCESS.md §6): a removed membership stays as a row the activity log
-- can name (requests never delete), and an invitee is found or made under the acting store's partner.

alter table membership drop constraint membership_status_check;
alter table membership add constraint membership_status_check check (status in ('invited', 'active', 'suspended', 'removed'));

-- The account an invitation names: the partner's person with this address, made `invited` when there
-- is none. Store scope only, under app.partner_id; null for a suspended or deleted account. The same
-- call whether or not the account exists, so the answer and its timing say nothing (ACCESS.md §6.2).
create function store_invitee(invite_email text, invite_name text) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  found_id uuid;
  found_status text;
begin
  if app_setting_text('app.scope') <> 'store' or app_setting_text('app.seller_id') <> '' then
    raise exception 'store_invitee: the merchant side of a store only';
  end if;
  select id, status into found_id, found_status from "user"
  where partner_id = app_setting_uuid('app.partner_id') and lower(email) = lower(invite_email);
  if found_id is null then
    insert into "user" (partner_id, email, name, status)
    values (app_setting_uuid('app.partner_id'), invite_email, invite_name, 'invited')
    returning id into found_id;
    return found_id;
  end if;
  return case when found_status in ('active', 'invited') then found_id end;
end
$$;

grant select (id, partner_id, email, status), insert (partner_id, email, name, status) on "user" to app_definer;
alter function store_invitee(text, text) owner to app_definer;
revoke execute on function store_invitee(text, text) from public;
grant execute on function store_invitee(text, text) to app_request;
