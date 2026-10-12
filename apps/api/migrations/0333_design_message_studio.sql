-- SAPI 17 (#318), part 2: the studio's requests, replies and errors join part 1's notes in the chat (DATA-MODEL §7.8).
-- An error's text is a code the portal words (FIRST-RELEASE §14), never stored words.
alter table design_message drop constraint design_message_role_check;
alter table design_message
  add constraint design_message_role_check check (role in ('user', 'ai', 'note', 'error')),
  add column changed text[] not null default '{}' check (cardinality(changed) <= 5),
  add column image_asset_id uuid references asset (id),
  add column sample_url text check (char_length(sample_url) <= 2048),
  add column page text check (char_length(page) <= 200),
  add column commit text check (commit ~ '^[0-9a-f]{40}$'),
  add column before_commit text check (before_commit ~ '^[0-9a-f]{40}$'),
  add column undone boolean not null default false,
  add column ai_run_id uuid references ai_run (id);
