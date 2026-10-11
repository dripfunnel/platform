-- INF 1 (#316), part 1: each store's public repo on GitHub and the pushes the platform makes to its `main`
-- (DATA-MODEL §7.8; storefront LIVE-SHOP.md §3, AI-STUDIO.md §6).

-- The repo's opaque name, its state, and the commit `main` is at: a push is refused unless GitHub's `main` is still there.
alter table storefront
  add column repo text unique check (repo ~ '^sf-[a-z0-9]{10}$'),
  add column repo_state text not null default 'none' check (repo_state in ('none', 'creating', 'ready', 'failed')),
  add column repo_head text check (repo_head ~ '^[0-9a-f]{40}$');

-- One row per push the platform asked for, by the caller's key, so a retried push never pushes twice. created_at is the
-- commit's date: a retry makes the same commit, and finds it on `main` if the first attempt got that far.
create table storefront_push (
  store_id uuid not null references store (id),
  key text not null check (char_length(key) between 1 and 200),
  parent_sha text not null check (parent_sha ~ '^[0-9a-f]{40}$'),
  commit_sha text check (commit_sha ~ '^[0-9a-f]{40}$'),
  state text not null check (state in ('pending', 'done')),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  primary key (store_id, key)
);

-- The platform's alone: only jobs push, and no person, partner or staff session reads a push.
grant select, insert, update, delete on storefront_push to app_system;
alter table storefront_push enable row level security;
alter table storefront_push force row level security;
create policy storefront_push_system on storefront_push for all to app_system using (true) with check (true);
create policy request_scope on storefront_push as restrictive for all to app_request using (false) with check (false);
create policy partner_scope on storefront_push as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on storefront_push as restrictive for all to app_platform using (false) with check (false);
create policy system_scope on storefront_push as restrictive for all to app_system
using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
