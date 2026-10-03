-- Publishing branding (#162) keeps the partner row's "Powered by" equal to the live version, as
-- it already does the product name and colours (0011's column grants; DATA-MODEL §2.5).
grant update (powered_by) on partner to app_partner;
