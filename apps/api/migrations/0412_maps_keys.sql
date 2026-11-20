-- Google Maps keys: a partner's own, DripFunnel's, and which one a partner's stores use (#1612; THIRD-PARTY-ACCESS §2.12, §4;
-- DATA-MODEL partner_credential, platform_credential). Additive: the previous release reads none of the new rows or columns.

-- A key is one more provider of a credential table, sealed in key_enc with its last four in key_prefix, as WhatsApp's is.
alter table partner_credential drop constraint partner_credential_kind_provider;
alter table partner_credential add constraint partner_credential_kind_provider check (
  (kind, provider) in (('ai', 'anthropic'), ('ai', 'openai'), ('sms', 'msg91'), ('sms', 'twilio'), ('sms', 'sns'), ('whatsapp', 'meta'), ('maps', 'google'))
);
alter table platform_credential drop constraint platform_credential_kind_provider;
alter table platform_credential add constraint platform_credential_kind_provider check (
  (kind, provider) in (('sms', 'msg91'), ('sms', 'twilio'), ('sms', 'sns'), ('whatsapp', 'meta'), ('maps', 'google'))
);

-- DripFunnel's key is off until Super admin turns it on; Admin then lets each partner use it, off for every partner until then.
alter table platform_messaging add column maps_enabled boolean not null default false;
alter table partner add column df_maps_enabled boolean not null default false;

-- Whose key the partner's stores use; null leaves it to its own key, if it has one. Only the partner writes it.
alter table partner add column maps_account text check (maps_account in ('own', 'dripfunnel'));
grant update (maps_account) on partner to app_partner;
