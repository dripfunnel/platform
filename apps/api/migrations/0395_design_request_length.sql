-- A studio request holds up to 10,000 characters (storefront AI-STUDIO §4 step 1), so a whole design brief fits. Both checks
-- only widen: every row today passes them, and the previous build never writes past its own smaller limits.
alter table design_message drop constraint design_message_text_check;
alter table design_message add constraint design_message_text_check check (char_length(text) <= 10000);
-- A plan's request lives in detail too, at up to 4 bytes a character beside its questions or plan.
alter table design_message drop constraint design_message_detail_check;
alter table design_message add constraint design_message_detail_check check (detail is null or octet_length(detail::text) <= 65536);
