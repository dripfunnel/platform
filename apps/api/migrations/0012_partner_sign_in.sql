-- Partner sign-in and its second factor (ACCESS.md §2, §4; #156).

-- The Owner's switch (ui/platform/FIRST-RELEASE.md §14.4); its screen is a later Settings card.
alter table partner add column second_factor_required boolean not null default false;

-- Five wrong codes pause sign-in for 15 minutes (FIRST-RELEASE §3); the last accepted time step
-- stops a code being replayed inside its window. No request role is granted these columns.
alter table partner_user
  add column two_factor_enrolled_at timestamptz,
  add column failed_code_count integer not null default 0,
  add column locked_until timestamptz,
  add column last_code_step bigint;

-- A password alone opens a session that answers only the second-factor routes: `second-factor`
-- for a user with 2-factor, `enrol` for one the partner requires to set it up. The secret being
-- enrolled waits here, encrypted, until a code proves it.
alter table partner_session
  add column stage text not null default 'full' check (stage in ('second-factor', 'enrol', 'full')),
  add column pending_secret_enc text;
