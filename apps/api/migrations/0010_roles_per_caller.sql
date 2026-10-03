-- One database role per caller kind (DATA-MODEL.md §5.3, #205). Staff requests run as
-- app_platform; every policy names the roles that may use it, and a restrictive pin on every
-- table holds each role to its own scopes, so a role can never use another's branch.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_platform') then
    create role app_platform nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_definer') then
    create role app_definer nologin bypassrls;
  end if;
end
$$;

-- 0007's membership trigger checks parents the caller may not see, so it runs as the role that
-- bypasses RLS (§5.3). Handing it over needs CREATE for the new owner and SET ROLE to it (PG 16+).
grant usage, create on schema public to app_definer;
grant app_definer to current_user;
grant select on store, "user", seller, membership to app_definer;
alter function membership_check_parents() owner to app_definer;

-- Whoever may become app_request (the Worker's login, THIRD-PARTY-ACCESS.md §2.2) may become
-- app_platform, or every Admin API request would fail at set role.
do $$
declare
  login text;
begin
  for login in
    select m.member::regrole::text from pg_auth_members m where m.roleid = 'app_request'::regrole
  loop
    execute format('grant app_platform to %s', login);
  end loop;
end
$$;

-- What staff requests use today, with the credential columns withheld as from app_request
-- (§2.1). The Customers menu and the Users tab read customers and suppliers, never write them.
grant usage on schema public to app_platform;
grant select, insert, update on partner, store to app_platform;
grant select on seller, staff_user to app_platform;
grant select (id, store_id, email, email_verified_at, phone, phone_verified_at, name, status, created_at) on customer to app_platform;
grant select, insert, update on staff_partner_assignment to app_platform;
grant select, insert on activity_log to app_platform;
grant insert on outbox to app_platform;
grant select, insert, update on partner_domain, partner_setup_item, plan, custom_domain, membership, job, job_detail, store_note to app_platform;
grant select, insert on partner_approval to app_platform;
grant insert on partner_user, partner_invitation, "user", invitation, partner_setup_session to app_platform;
grant select (id, partner_id, email, name, role_key, status, last_sign_in_at, created_at),
      update (email, name, role_key, status, last_sign_in_at) on partner_user to app_platform;
grant select (id, partner_id, partner_user_id, expires_at, sent_at, invited_by_kind, invited_by_label, accepted_at, revoked_at, created_at),
      update (expires_at, sent_at, accepted_at, revoked_at) on partner_invitation to app_platform;
grant select (id, partner_id, email, email_verified_at, name, status, last_sign_in_at, created_at),
      update (email, email_verified_at, name, status, last_sign_in_at) on "user" to app_platform;
grant select (id, store_id, seller_id, email, role_key, expires_at, invited_by_user_id, invited_by_label, accepted_at, revoked_at, created_at),
      update (expires_at, accepted_at, revoked_at) on invitation to app_platform;
grant select (id, staff_user_id, partner_id, reason, ticket, started_at, expires_at, ended_at, ended_by_staff_id, handoff_expires_at, handoff_used_at),
      update (ended_at, ended_by_staff_id, handoff_hash, handoff_expires_at) on partner_setup_session to app_platform;

-- Each policy goes to the roles whose scopes it names: store, shop and partner are
-- app_request's until their own roles arrive, platform is app_platform's, system app_system's.
-- app_request keeps every platform branch until #210: the Worker still live when this runs
-- serves staff as app_request, and must work until the new one is promoted.
alter policy partner_read on partner to app_request, app_platform;
alter policy partner_insert on partner to app_request, app_platform;
alter policy partner_update on partner to app_request, app_platform;
alter policy partner_system on partner to app_system;
alter policy store_read on store to app_request, app_platform;
alter policy store_insert on store to app_request, app_platform;
alter policy store_update on store to app_request, app_platform;
alter policy store_system on store to app_system;
alter policy seller_read on seller to app_request, app_platform, app_system;
alter policy seller_insert on seller to app_request;
alter policy seller_update on seller to app_request;
alter policy customer_read on customer to app_request, app_platform;
alter policy customer_insert on customer to app_request;
alter policy customer_update on customer to app_request;
alter policy staff_user_read on staff_user to app_request, app_platform, app_system;
alter policy staff_session_write on staff_session to app_system;
alter policy staff_partner_assignment_read on staff_partner_assignment to app_request, app_platform, app_system;
alter policy staff_partner_assignment_write on staff_partner_assignment to app_request, app_platform;
alter policy staff_partner_assignment_update on staff_partner_assignment to app_request, app_platform;
alter policy activity_log_read on activity_log to app_request, app_platform, app_system;
alter policy activity_log_insert on activity_log to app_request, app_platform, app_system;
alter policy outbox_insert on outbox to app_request, app_platform, app_system;
alter policy outbox_relay on outbox to app_system;
alter policy outbox_relay_update on outbox to app_system;
alter policy plan_store_read on plan to app_request;
alter policy custom_domain_read on custom_domain to app_request, app_platform, app_system;
alter policy custom_domain_write on custom_domain to app_request, app_platform, app_system;
alter policy custom_domain_update on custom_domain to app_request, app_platform, app_system;
alter policy job_read on job to app_request, app_platform, app_system;
alter policy job_write on job to app_request, app_platform, app_system;
alter policy job_update on job to app_request, app_platform, app_system;
alter policy membership_read on membership to app_request, app_platform, app_system;
alter policy membership_write on membership to app_request, app_platform, app_system;
alter policy membership_update on membership to app_request, app_platform, app_system;
alter policy user_read on "user" to app_request, app_platform, app_system;
alter policy user_write on "user" to app_request, app_platform, app_system;
alter policy user_update on "user" to app_request, app_platform, app_system;
alter policy invitation_read on invitation to app_request, app_platform, app_system;
alter policy invitation_write on invitation to app_request, app_platform, app_system;
alter policy invitation_update on invitation to app_request, app_platform, app_system;
alter policy store_note_read on store_note to app_request, app_platform;
alter policy store_note_write on store_note to app_request, app_platform;
alter policy job_detail_read on job_detail to app_request, app_platform, app_system;
alter policy job_detail_write on job_detail to app_request, app_platform, app_system;
alter policy job_detail_update on job_detail to app_request, app_platform, app_system;
alter policy partner_setup_session_read on partner_setup_session to app_request, app_platform, app_system;
alter policy partner_setup_session_insert on partner_setup_session to app_request, app_platform;
alter policy partner_setup_session_update on partner_setup_session to app_request, app_platform, app_system;
alter policy partner_approval_read on partner_approval to app_request, app_platform;
alter policy partner_approval_insert on partner_approval to app_request, app_platform;

do $$
declare
  t text;
begin
  -- The partner-scoped tables 0007 built in a loop.
  foreach t in array array['partner_user', 'partner_invitation', 'partner_domain', 'partner_setup_item', 'plan'] loop
    execute format('alter policy %I on %I to app_request, app_platform, app_system', t || '_read', t);
    execute format('alter policy %I on %I to app_request, app_platform, app_system', t || '_insert', t);
    execute format('alter policy %I on %I to app_request, app_platform, app_system', t || '_update', t);
  end loop;

  -- Support sessions run as app_request alone (§5.2).
  for t in
    select c.relname from pg_policy p join pg_class c on c.oid = p.polrelid
    where p.polname = 'support_no_insert' and c.relnamespace = 'public'::regnamespace
  loop
    execute format('alter policy support_no_insert on %I to app_request', t);
    execute format('alter policy support_no_update on %I to app_request', t);
    execute format('alter policy support_no_delete on %I to app_request', t);
  end loop;

  -- The pins: a role reaches only the rows its own scopes admit, whatever app.scope says
  -- (platform stays in app_request's until #210, as above).
  for t in
    select c.relname from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and c.relrowsecurity
  loop
    execute format(
      'create policy request_scope on %I as restrictive for all to app_request
         using (app_setting_text(''app.scope'') in (''store'', ''shop'', ''partner'', ''platform''))
         with check (app_setting_text(''app.scope'') in (''store'', ''shop'', ''partner'', ''platform''))', t);
    execute format(
      'create policy platform_scope on %I as restrictive for all to app_platform
         using (app_setting_text(''app.scope'') = ''platform'')
         with check (app_setting_text(''app.scope'') = ''platform'')', t);
    execute format(
      'create policy system_scope on %I as restrictive for all to app_system
         using (app_setting_text(''app.scope'') = ''system'')
         with check (app_setting_text(''app.scope'') = ''system'')', t);
  end loop;
end
$$;
