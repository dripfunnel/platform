-- The partner's look and words as versions (SAAS.md §3.3, §3.4; DATA-MODEL.md §2.5; #211): at
-- most one draft per partner, and every published version kept, newest live, which is the
-- history ui/platform/FIRST-RELEASE.md §8.4 reads. #162 serves and publishes them.
create table partner_branding (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partner (id),
  state text not null check (state in ('draft', 'published', 'cancelled')),
  -- The look (§3.3).
  product_name text not null check (char_length(product_name) between 1 and 60),
  primary_color text not null check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  accent_color text not null check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  font text not null check (font in ('Nunito', 'Source Sans 3', 'Manrope', 'Lora', 'DM Sans')),
  corner text not null check (corner in ('rounded', 'soft', 'square')),
  background text not null check (background in ('sand', 'plain', 'photo')),
  -- R2 object keys of the four files; never a URL a browser was given.
  logo_light_key text,
  logo_dark_key text,
  mark_key text,
  favicon_key text,
  -- The words (§3.4).
  support_email text,
  support_url text,
  help_url text,
  terms_url text,
  privacy_url text,
  dpa_url text,
  impressum text check (char_length(impressum) <= 2000),
  powered_by boolean not null default true,
  created_by_kind text not null check (created_by_kind in ('partner_user', 'staff', 'system')),
  created_by_label text not null,
  created_at timestamptz(3) not null default now(),
  published_at timestamptz(3),
  published_by_label text,
  -- A version scheduled for later (F8) is published with its time still ahead; cancelled, it
  -- keeps the time it would have gone live.
  constraint partner_branding_published check ((state = 'draft') = (published_at is null) and (published_at is null) = (published_by_label is null))
);

create unique index partner_branding_draft_key on partner_branding (partner_id) where state = 'draft';
create index partner_branding_published_idx on partner_branding (partner_id, published_at desc, id desc) where state = 'published';

-- The partner writes its own drafts and reads its history; a published version is never
-- rewritten (a rollback publishes a copy). Staff and jobs reach every partner's.
grant select, insert on partner_branding to app_partner, app_platform;
grant update (product_name, primary_color, accent_color, font, corner, background, logo_light_key, logo_dark_key, mark_key, favicon_key,
  support_email, support_url, help_url, terms_url, privacy_url, dpa_url, impressum, powered_by, state, published_at, published_by_label)
  on partner_branding to app_partner, app_platform;
grant select, insert on partner_branding to app_system;
grant update (product_name, primary_color, accent_color, font, corner, background, logo_light_key, logo_dark_key, mark_key, favicon_key,
  support_email, support_url, help_url, terms_url, privacy_url, dpa_url, impressum, powered_by, state, published_at, published_by_label)
  on partner_branding to app_system;

alter table partner_branding enable row level security;
alter table partner_branding force row level security;
create policy request_scope on partner_branding as restrictive for all to app_request
  using (app_setting_text('app.scope') in ('store', 'shop')) with check (app_setting_text('app.scope') in ('store', 'shop'));
create policy partner_scope on partner_branding as restrictive for all to app_partner
  using (app_setting_text('app.scope') = 'partner') with check (app_setting_text('app.scope') = 'partner');
create policy platform_scope on partner_branding as restrictive for all to app_platform
  using (app_setting_text('app.scope') = 'platform') with check (app_setting_text('app.scope') = 'platform');
create policy system_scope on partner_branding as restrictive for all to app_system
  using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');

create policy partner_branding_partner_read on partner_branding for select to app_partner
  using (partner_id = app_setting_uuid('app.partner_id'));
create policy partner_branding_partner_insert on partner_branding for insert to app_partner
  with check (partner_id = app_setting_uuid('app.partner_id') and created_by_kind = 'partner_user');
-- A draft is edited or published; a scheduled version, not live yet, may only be cancelled
-- (the trigger below holds what changes).
create policy partner_branding_partner_update on partner_branding for update to app_partner
  using (partner_id = app_setting_uuid('app.partner_id') and (state = 'draft' or (state = 'published' and published_at > now())))
  with check (partner_id = app_setting_uuid('app.partner_id'));
create policy partner_branding_staff_read on partner_branding for select to app_platform, app_system using (true);
create policy partner_branding_staff_insert on partner_branding for insert to app_platform, app_system with check (true);
create policy partner_branding_staff_update on partner_branding for update to app_platform, app_system
  using (state = 'draft' or (state = 'published' and published_at > now())) with check (true);

-- What a request or a job may do to a version (#211): add a draft; publish a draft no earlier
-- than now, so history is never back-dated; cancel a scheduled version and change nothing else.
-- Anything live or past is never rewritten.
create function partner_branding_guard() returns trigger
language plpgsql
as $$
begin
  if current_user not in ('app_partner', 'app_platform', 'app_system') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.state <> 'draft' then
      raise exception 'partner_branding: a version starts as a draft' using errcode = 'check_violation';
    end if;
  elsif old.state = 'draft' then
    -- published_at holds milliseconds, so "now" is compared at that precision.
    if new.state = 'cancelled' or (new.state = 'published' and new.published_at < date_trunc('milliseconds', now())) then
      raise exception 'partner_branding: a draft is published now or later' using errcode = 'check_violation';
    end if;
  elsif not (old.state = 'published' and old.published_at > now() and new.state = 'cancelled'
             and to_jsonb(new) - 'state' = to_jsonb(old) - 'state') then
    raise exception 'partner_branding: a published version is never changed, only a scheduled one cancelled' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger partner_branding_guard before insert or update on partner_branding
for each row execute function partner_branding_guard();
