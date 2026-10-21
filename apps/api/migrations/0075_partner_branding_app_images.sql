-- The merchant app's icon, Android icon foreground and splash (#495; BUILD-CHECKLIST §2), versioned
-- with the rest of the look. Nullable, so the previous release writes rows without them.
alter table partner_branding
  add column app_icon_key text,
  add column app_icon_foreground_key text,
  add column splash_key text;

grant update (app_icon_key, app_icon_foreground_key, splash_key) on partner_branding to app_partner, app_platform, app_system;
