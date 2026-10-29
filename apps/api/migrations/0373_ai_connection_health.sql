-- AI connections as managed records (docs/api/SAAS.md §9.3): what the gateway needs to skip, report and prefer a credential.
-- Columns on the two credential tables, not a new table: one row is already one connection. Additive and nullable (fallback
-- is off by default), so the previous release reads and writes both tables as before. No key or token is stored here.
alter table store_ai_account add column if not exists last_validated_at timestamptz;
alter table store_ai_account add column if not exists last_validation_status text check (last_validation_status in ('ok', 'rejected', 'unavailable'));
alter table store_ai_account add column if not exists cooldown_until timestamptz;
-- A 429 on one model must not block the others on the same credential: model id -> end of its cooldown.
alter table store_ai_account add column if not exists cooldown_models jsonb not null default '{}'::jsonb;
alter table store_ai_account add column if not exists preferred_model text check (char_length(preferred_model) between 1 and 100);
-- The Owner's explicit yes to running on this account when the partner's default one can't; off, so nothing switches who pays.
alter table store_ai_account add column if not exists fallback_authorized boolean not null default false;

alter table partner_credential add column if not exists last_validated_at timestamptz;
alter table partner_credential add column if not exists last_validation_status text check (last_validation_status in ('ok', 'rejected', 'unavailable'));
alter table partner_credential add column if not exists cooldown_until timestamptz;
alter table partner_credential add column if not exists cooldown_models jsonb not null default '{}'::jsonb;
alter table partner_credential add column if not exists preferred_model text check (char_length(preferred_model) between 1 and 100);

-- Health is metadata; the sealed key stays granted to app_system alone. Writes are system scope (table-level grants already cover them).
grant select (last_validated_at, last_validation_status, cooldown_until, preferred_model, fallback_authorized) on store_ai_account to app_request;
grant select (last_validated_at, last_validation_status, cooldown_until, preferred_model) on partner_credential to app_partner, app_platform;
