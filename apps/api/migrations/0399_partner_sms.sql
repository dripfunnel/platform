-- A partner's own SMS accounts and its SMS switch (#1017; THIRD-PARTY-ACCESS §4, §8.3; DATA-MODEL partner_credential).
-- An `sms` row is one provider's account: the secret sealed in key_enc as for AI keys, the parts that aren't secret in
-- `settings`. Additive: the previous release reads only `kind = 'ai'` rows and never the new column.
alter table partner_credential drop constraint partner_credential_kind_check;
alter table partner_credential drop constraint partner_credential_provider_check;
-- One check for which providers each kind takes, so a later kind (#1504) replaces this one constraint.
alter table partner_credential add constraint partner_credential_kind_provider check (
  (kind, provider) in (('ai', 'anthropic'), ('ai', 'openai'), ('sms', 'msg91'), ('sms', 'twilio'))
);
alter table partner_credential add column settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object');
-- AI keys are named profiles; every other kind is one account per provider.
create unique index partner_credential_account_key on partner_credential (partner_id, kind, provider) where kind <> 'ai';

-- key_enc stays readable by app_system alone; a save writes it without reading it back.
grant select (settings) on partner_credential to app_partner, app_platform;
grant update (key_enc, key_prefix, settings) on partner_credential to app_partner;

-- Off sends the partner's stores no text through any account, DripFunnel's included (THIRD-PARTY-ACCESS §4).
alter table partner add column sms_enabled boolean not null default true;
grant update (sms_enabled) on partner to app_partner;
