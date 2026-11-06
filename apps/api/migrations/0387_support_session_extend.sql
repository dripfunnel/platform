-- A partner support session lasts 90 minutes and its agent may extend it once by 30 (ACCESS.md §8, as staff
-- impersonation's §8.1): from the partner console (partner scope) or its banner on the portal host (system scope).

alter table support_session add column extended_at timestamptz(3);

grant select (extended_at), update (expires_at, extended_at) on support_session to app_partner, app_system;
grant select (extended_at) on support_session to app_platform;
