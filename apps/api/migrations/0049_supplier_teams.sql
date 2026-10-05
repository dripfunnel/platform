-- SAPI 5 (#295), part 3: a Supplier admin's own team (ACCESS §7.5): invite, resend, cancel, change role and
-- remove, in its own supplier only and only with supplier roles; joining stays the invitation's (§6.2).

grant insert (id, store_id, seller_id, email, role_key, expires_at, invited_by_user_id, invited_by_label, created_at),
      update (revoked_at) on invitation to app_supplier;
grant insert (user_id, store_id, seller_id, role_key, status, invited_by_user_id),
      update (status, role_key, invited_by_user_id) on membership to app_supplier;

-- 0007's write policies admit a supplier's invitation in its own seller with any role; these hold it to the two.
create policy invitation_supplier_insert on invitation as restrictive for insert to app_supplier
with check (seller_id = app_setting_uuid('app.seller_id') and role_key in ('supplier-admin', 'supplier-member'));
create policy invitation_supplier_update on invitation as restrictive for update to app_supplier
using (seller_id = app_setting_uuid('app.seller_id'))
with check (seller_id = app_setting_uuid('app.seller_id') and role_key in ('supplier-admin', 'supplier-member'));

create policy membership_supplier_insert on membership for insert to app_supplier
with check (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id')
  and seller_id = app_setting_uuid('app.seller_id') and role_key in ('supplier-admin', 'supplier-member') and status = 'invited');
create policy membership_supplier_update on membership for update to app_supplier
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and seller_id = app_setting_uuid('app.seller_id'))
with check (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id')
  and seller_id = app_setting_uuid('app.seller_id') and role_key in ('supplier-admin', 'supplier-member'));

-- Only accepting an invitation makes a membership active, so a supplier never activates or restores one itself.
create function membership_supplier_status() returns trigger
language plpgsql
as $$
begin
  if current_user = 'app_supplier' and new.status is distinct from old.status and new.status not in ('invited', 'removed') then
    raise exception 'membership: a supplier only invites and removes';
  end if;
  return new;
end
$$;
create trigger membership_supplier_status before update on membership
for each row execute function membership_supplier_status();

-- 0040's invitee, for a supplier's own invitations too: the same answer whatever the account's state.
create or replace function store_invitee(invite_email text, invite_name text) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  found_id uuid;
  found_status text;
begin
  if app_setting_text('app.scope') <> 'store' then
    raise exception 'store_invitee: a store''s people only';
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
grant execute on function store_invitee(text, text) to app_supplier;
