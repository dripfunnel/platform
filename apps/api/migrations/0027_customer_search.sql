-- The admin console's Customers (ui/admin/FIRST-RELEASE.md §5.4; #36): an indexed exact search
-- by email or by phone digits with or without the country code (decided on #42), and the
-- last sign-in the list shows, which the Shop API's sign-in will write.

-- E.164's country calling code (ITU-T E.164 assignments). The codes are prefix-free, so the
-- first that matches is the one; null for a number that isn't E.164.
create function calling_code_of(phone text) returns text
language sql immutable parallel safe
as $$
  with d as (select regexp_replace(coalesce(phone, ''), '\D', '', 'g') as digits)
  select case
    when left(digits, 1) in ('1', '7') then left(digits, 1)
    when left(digits, 2) = any(array[
      '20','27','30','31','32','33','34','36','39','40','41','43','44','45','46','47','48','49','51','52','53','54','55',
      '56','57','58','60','61','62','63','64','65','66','81','82','84','86','90','91','92','93','94','95','98']) then left(digits, 2)
    when left(digits, 3) = any(array[
      '211','212','213','216','218','220','221','222','223','224','225','226','227','228','229','230','231','232','233',
      '234','235','236','237','238','239','240','241','242','243','244','245','246','247','248','249','250','251','252',
      '253','254','255','256','257','258','260','261','262','263','264','265','266','267','268','269','290','291','297',
      '298','299','350','351','352','353','354','355','356','357','358','359','370','371','372','373','374','375','376',
      '377','378','379','380','381','382','383','385','386','387','389','420','421','423','500','501','502','503','504',
      '505','506','507','508','509','590','591','592','593','594','595','596','597','598','599','670','672','673','674',
      '675','676','677','678','679','680','681','682','683','685','686','687','688','689','690','691','692','800','808',
      '850','852','853','855','856','870','878','880','881','882','883','886','888','960','961','962','963','964','965',
      '966','967','968','970','971','972','973','974','975','976','977','979','992','993','994','995','996','998']) then left(digits, 3)
  end
  from d
$$;

alter table customer
  add column last_sign_in_at timestamptz,
  -- The forms a search compares, stored so each has an index: every digit, the calling code,
  -- and the national number after it.
  add column phone_digits text generated always as (nullif(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), '')) stored,
  add column phone_country_code text generated always as (calling_code_of(phone)) stored,
  add column phone_national text generated always as (
    nullif(substr(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), coalesce(length(calling_code_of(phone)), 0) + 1), '')
  ) stored;

create index customer_phone_digits_idx on customer (phone_digits);
create index customer_phone_national_idx on customer (phone_national);
create index customer_email_lower_idx on customer (lower(email));
create index customer_name_trgm_idx on customer using gin (name gin_trgm_ops);
-- Milliseconds, as the list's cursor carries, so its keyset is the plain column these index.
alter table customer alter column created_at type timestamptz(3);
create index customer_created_idx on customer (created_at desc, id desc);
create index customer_store_created_idx on customer (store_id, created_at desc, id desc);
create index customer_last_sign_in_idx on customer (last_sign_in_at);

-- A WHERE clause needs the select grant; like email and phone, the API masks or omits them.
grant select (last_sign_in_at, phone_digits, phone_country_code, phone_national) on customer to app_platform;
