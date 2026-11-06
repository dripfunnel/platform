-- Testing a partner's AI key records the answer as its connection health too (0373, #1006); the partner's role
-- wrote those two columns without the grant, so every key test was refused.
grant update (last_validated_at, last_validation_status) on partner_credential to app_partner;
