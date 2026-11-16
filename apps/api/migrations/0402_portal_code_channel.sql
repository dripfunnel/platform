-- A portal code goes by WhatsApp or by SMS (#1506, ACCESS.md §4): each send keeps its channel, so the 20-second rule
-- can read the last one. Existing rows were all texted; the previous release's inserts get 'sms' by default.

alter table verification_code add column channel text not null default 'sms' check (channel in ('sms', 'whatsapp'));
alter table signup_text add column channel text not null default 'sms' check (channel in ('sms', 'whatsapp'));
