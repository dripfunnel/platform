-- A studio frame opened by staff impersonating a user or by a partner's support session (ACCESS.md §8, §8.1; storefront
-- AI-STUDIO.md §8): bound to that session instead of a portal sign-in, live only while it is open. Nothing is destroyed.
alter table studio_session
  alter column user_session_hash drop not null,
  add column impersonation_id uuid references impersonation (id) on delete cascade,
  add column support_session_id uuid references support_session (id) on delete cascade,
  add constraint studio_session_one_holder check (num_nonnulls(user_session_hash, impersonation_id, support_session_id) = 1);
create index studio_session_impersonation_idx on studio_session (impersonation_id) where impersonation_id is not null;
create index studio_session_support_session_idx on studio_session (support_session_id) where support_session_id is not null;
