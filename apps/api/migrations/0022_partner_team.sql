-- The partner's Settings: its team and its 2-factor policy (ui/platform/FIRST-RELEASE.md §14.2,
-- §14.4; ACCESS.md §5.3; #199).

-- Removed from the team: signed out, never signed in again, still named in the activity log.
-- Sign-in and the session read `active` only (partnerUsers.ts), so nothing else changes.
alter table partner_user drop constraint partner_user_status_check;
alter table partner_user add constraint partner_user_status_check check (status in ('invited', 'active', 'suspended', 'removed'));

-- The team list shows who has 2-factor on; the Owner sets the policy.
grant select (two_factor_enrolled_at) on partner_user to app_partner;
grant update (second_factor_required) on partner to app_partner;

-- Removal ends the person's sessions at once, though a partner role never reads or writes the
-- session table (0011): this ends only the sessions of its own partner's users.
create function end_partner_user_sessions(p_user uuid) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  ended integer;
begin
  if app_setting_text('app.scope') <> 'partner' then
    raise exception 'end_partner_user_sessions: partner scope only' using errcode = 'insufficient_privilege';
  end if;
  delete from partner_session s using partner_user u
  where s.partner_user_id = p_user and u.id = p_user and u.partner_id = app_setting_uuid('app.partner_id');
  get diagnostics ended = row_count;
  return ended;
end
$$;

grant select, delete on partner_session to app_definer;
grant select on partner_user to app_definer;
alter function end_partner_user_sessions(uuid) owner to app_definer;
revoke all on function end_partner_user_sessions(uuid) from public;
grant execute on function end_partner_user_sessions(uuid) to app_partner;
