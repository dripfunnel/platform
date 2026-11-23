-- The Shiprocket sales channel a store's booked orders land in (THIRD-PARTY-ACCESS §4; DATA-MODEL §7.2): Settings ›
-- Channels' id, no secret, so the store reads it back. Null is Shiprocket's default channel. Backward-compatible.

alter table courier_account add column channel_id text check (channel_id ~ '^[0-9]{1,20}$');

grant select (channel_id) on courier_account to app_request;
