-- OAuth sign-in for AI accounts (#950; docs/api/SAAS.md §9.3, DATA-MODEL §7). A sign-in is the same one account a key is, with
-- its tokens sealed in key_enc as JSON; `auth_type` says which. Existing rows stay `api_key`, so the previous release reads
-- them as before. Before rolling the code back, delete the `oauth` rows: the old code would read their JSON as a key.
alter table store_ai_account add column auth_type text not null default 'api_key' check (auth_type in ('api_key', 'oauth'));
alter table store_ai_account add column account_label text check (char_length(account_label) <= 200);
grant select (auth_type, account_label) on store_ai_account to app_request;

alter table partner_credential add column auth_type text not null default 'api_key' check (auth_type in ('api_key', 'oauth'));
alter table partner_credential add column account_label text check (char_length(account_label) <= 200);
grant select (auth_type, account_label) on partner_credential to app_partner, app_platform;
-- A finished sign-in is taken and stored in one system-scope transaction.
grant insert on partner_credential to app_system;

-- Usage by owner, provider, authentication method and model (ai_run has the rest): api_key_id is the caller, billed_to the owner.
alter table ai_run add column auth_method text not null default 'api_key' check (auth_method in ('api_key', 'oauth'));

-- A sign-in between leaving for the provider and finishing (as payment_connect is for Stripe): hashes of the one-time values only,
-- the PKCE verifier and, once approved, the tokens sealed. One live attempt per owner; starting again replaces it.
create table ai_oauth_attempt (
  id uuid primary key default gen_random_uuid(),
  owner_kind text not null check (owner_kind in ('store', 'partner')),
  owner_id uuid not null,
  partner_id uuid not null references partner (id),
  provider text not null check (provider in ('anthropic', 'openai')),
  -- The partner profile a reconnect replaces; null for a first sign-in and for a store (one account each).
  credential_id uuid references partner_credential (id) on delete cascade,
  status text not null check (status in ('pending', 'approved')),
  state_hash text check (state_hash ~ '^[0-9a-f]{64}$'),
  finish_hash text check (finish_hash ~ '^[0-9a-f]{64}$'),
  verifier_enc text not null,
  tokens_enc text,
  account_label text check (char_length(account_label) <= 200),
  return_host text not null check (char_length(return_host) <= 255),
  started_by uuid not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint ai_oauth_attempt_tokens check ((status = 'approved') = (tokens_enc is not null))
);
create unique index ai_oauth_attempt_owner_key on ai_oauth_attempt (owner_kind, owner_id);
create unique index ai_oauth_attempt_state_key on ai_oauth_attempt (state_hash) where state_hash is not null;
create unique index ai_oauth_attempt_finish_key on ai_oauth_attempt (finish_hash) where finish_hash is not null;

grant select, insert, update, delete on ai_oauth_attempt to app_system;
alter table ai_oauth_attempt enable row level security;
alter table ai_oauth_attempt force row level security;
create policy ai_oauth_attempt_system on ai_oauth_attempt for all to app_system using (true) with check (true);
create policy system_scope on ai_oauth_attempt as restrictive for all to app_system
  using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
create policy request_scope on ai_oauth_attempt as restrictive for all to app_request, app_shop using (false) with check (false);
create policy partner_scope on ai_oauth_attempt as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on ai_oauth_attempt as restrictive for all to app_platform using (false) with check (false);
