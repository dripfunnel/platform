-- #1243 (DATA-MODEL §7.8; storefront AI-STUDIO §4): a vague request's quick questions and its plan are studio messages,
-- `detail` holding them; a build's message names its pages there. Read with a strict schema, never shown raw.
alter table design_message drop constraint design_message_role_check;
alter table design_message
  add constraint design_message_role_check check (role in ('user', 'ai', 'note', 'error', 'questions', 'plan')),
  add column detail jsonb check (detail is null or octet_length(detail::text) <= 16384);
