-- A partner removes an address it added (SAAS §8): the row and its records go in the partner's
-- own transaction; the Cloudflare for SaaS hostname is removed after commit through the outbox.
grant delete on partner_domain, partner_domain_record to app_partner;
