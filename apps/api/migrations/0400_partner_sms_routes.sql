-- AWS SNS as a third SMS provider, and the partner's provider per route (#1017; THIRD-PARTY-ACCESS §4).
-- Additive: an `sns` row and the two route columns are new, and the previous release reads neither.
alter table partner_credential drop constraint partner_credential_kind_provider;
alter table partner_credential add constraint partner_credential_kind_provider check (
  (kind, provider) in (('ai', 'anthropic'), ('ai', 'openai'), ('sms', 'msg91'), ('sms', 'twilio'), ('sms', 'sns'))
);

-- Null leaves the route to the first of its providers the partner holds an account for.
alter table partner add column sms_route_india text check (sms_route_india in ('msg91', 'sns'));
alter table partner add column sms_route_rest text check (sms_route_rest in ('twilio', 'sns'));
grant update (sms_route_india, sms_route_rest) on partner to app_partner;
