-- A partner removes an address it added (SAAS §8): the row and its records go in the partner's
-- own transaction; the Cloudflare for SaaS hostname is removed after commit through the outbox.
-- Row-level security has a policy per command (0007), so the grant alone would delete nothing.
grant delete on partner_domain, partner_domain_record to app_partner;
create policy partner_domain_delete on partner_domain for delete to app_partner
  using (app_setting_text('app.scope') = 'partner' and partner_id = app_setting_uuid('app.partner_id'));
