-- SAPI 20 (#330), part 2, review: whether the app was told its grant's token, so an install whose notice never got
-- through shows as such and its Owner can remove it and install again (the token itself is kept nowhere).

alter table app_grant add column token_sent_at timestamptz(3);
alter table app_grant add column token_failed_at timestamptz(3);
grant select (token_sent_at, token_failed_at) on app_grant to app_request;
grant update (token_sent_at, token_failed_at) on app_grant to app_system;
