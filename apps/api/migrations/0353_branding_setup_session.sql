-- A staff setup session publishes the look as staff, with no partner user (ACCESS.md §8.2); 0016 refused its draft.
drop policy partner_branding_partner_insert on partner_branding;
create policy partner_branding_partner_insert on partner_branding for insert to app_partner
  with check (partner_id = app_setting_uuid('app.partner_id')
    and created_by_kind = case when app_setting_text('app.user_id') = '' then 'staff' else 'partner_user' end);
