-- A partner's own WhatsApp Business account on Meta's Cloud API, and its WhatsApp switch (#1504; THIRD-PARTY-ACCESS §4,
-- §8.3; DATA-MODEL partner_credential). Additive: the previous release reads neither a `whatsapp` row nor the new column.
alter table partner_credential drop constraint partner_credential_kind_provider;
alter table partner_credential add constraint partner_credential_kind_provider check (
  (kind, provider) in (('ai', 'anthropic'), ('ai', 'openai'), ('sms', 'msg91'), ('sms', 'twilio'), ('sms', 'sns'), ('whatsapp', 'meta'))
);
-- One account per partner: partner_credential_account_key (0399) holds one row per kind and provider, and Meta is the only one.

-- Off until the partner turns it on with a saved account (saas/partnerCredentials/whatsapp.ts).
alter table partner add column whatsapp_enabled boolean not null default false;
grant update (whatsapp_enabled) on partner to app_partner;
