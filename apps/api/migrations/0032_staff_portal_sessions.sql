-- The partner console's half of staff sessions (ACCESS.md §8.3, #243). Spending a handoff gives the
-- browser a cookie of its own; only its hash is kept, on the session it opens, and a fresh handoff
-- (a return) replaces it. Like the handoff hash it is a credential: only app_system reads it.

alter table impersonation add column portal_session_hash text unique;

alter table partner_setup_session
  add column portal_session_hash text unique,
  -- Why it ended, as impersonation records it, so an end from the console or a closed partner
  -- reads as that and not as the staff member's own end. Rows ended before this are left null.
  add column end_reason text check (end_reason in ('staff', 'expired', 'portal', 'partner_closed'));

grant select (end_reason), update (end_reason) on partner_setup_session to app_request, app_platform;
