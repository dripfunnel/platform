-- #1017: a partner's own SMS account (MSG91 or Twilio) beside its AI keys (docs/code/THIRD-PARTY-ACCESS.md §2.8, §8.3).
-- Same table, a new kind: the secret (MSG91's auth key, Twilio's auth token) is sealed in key_enc and read by app_system alone;
-- what is not secret (Twilio's account and messaging service sids, MSG91's seven template ids) goes in `settings`.
-- Additive: the previous release reads and writes only `ai` rows and never sees an `sms` one, so it runs unchanged on this schema.
alter table partner_credential drop constraint partner_credential_kind_check;
alter table partner_credential add constraint partner_credential_kind_check check (kind in ('ai', 'sms'));
alter table partner_credential drop constraint partner_credential_provider_check;
alter table partner_credential add constraint partner_credential_provider_check check (provider in ('anthropic', 'openai', 'msg91', 'twilio'));
-- A kind keeps its own providers, so an `sms` row can never be read as an AI key.
alter table partner_credential add constraint partner_credential_kind_provider_check
  check ((kind = 'ai' and provider in ('anthropic', 'openai')) or (kind = 'sms' and provider in ('msg91', 'twilio')));

alter table partner_credential add column settings jsonb not null default '{}'::jsonb;

-- One SMS account per provider per partner.
create unique index partner_credential_sms_provider_key on partner_credential (partner_id, provider) where kind = 'sms';

-- Settings hold no secret, so the console and staff read them; key_enc stays granted to app_system alone (0368).
grant select (settings) on partner_credential to app_partner, app_platform;
