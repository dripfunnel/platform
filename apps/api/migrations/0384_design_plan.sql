-- #1243 (DATA-MODEL §7.8; storefront AI-STUDIO §4): a vague request's quick questions and its plan are studio messages,
-- `detail` holding them; a build's message names its pages there. Read with a strict schema, never shown raw.
alter table design_message drop constraint design_message_role_check;
alter table design_message
  add constraint design_message_role_check check (role in ('user', 'ai', 'note', 'error', 'questions', 'plan')),
  add column detail jsonb check (detail is null or octet_length(detail::text) <= 16384);

-- Claiming a flow to answer or build it, and giving it back, is the merchant's own write under the store's row-level
-- security: only `detail` of a questions or plan message of the acting store, never a supplier's. The rest stays system's.
grant update (detail) on design_message to app_request;
create policy design_message_merchant_flow on design_message for update to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '' and role in ('questions', 'plan'))
with check (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '' and role in ('questions', 'plan'));
