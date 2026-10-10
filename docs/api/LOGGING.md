# LOGGING.md: the activity log and technical logs

What the platform records about who did what, at every level (admin console, partner
console, merchant portal, storefront and the system itself), where it is stored, who may
see which entries, and how people search it. **The activity log is the audit log**: older
text that says "audit log" or `audit_log` means the activity log specified here.

Decided 2026-09-28: log every action and sign-in by every kind of user, shoppers included;
store it in Postgres; shopper activity is visible to the merchant and to staff only; keep
13 months searchable, then archive for 7 years.

Last updated: 2026-10-09 (#520: credentials in a URL path are never logged, §9).

---

## 1. Decisions

| Decision | Rejected | Why |
|---|---|---|
| **Log every write and every sign-in, by every caller**, shoppers' account events included | Only privileged writes; also every read and page view; also shopper browsing | Answers "who did what" for any person at any level. Reads and browsing multiply volume by 10–50×, log personal-data access at scale and, for browsing, need consent: that is analytics, not an audit log. |
| **One append-only `activity_log` table in Postgres** (Neon), partitioned by month | An external log service (Axiom, Better Stack); both | Written in the same transaction as the change, so nothing is lost and nothing is logged for a rolled-back change. The consoles query it through the APIs with the same tenant scoping as all other data. No new vendor holding personal data. |
| **One log for all levels**, with scope columns (partner, store, seller, customer) and a visibility level | A log per portal | A person acts in many stores and portals with one login; one table lets staff follow one person across everything and lets each viewer see exactly their scope. |
| **Shopper activity visible to the merchant (Owner, Manager) and to staff** | Staff only; partners too | Merchants own their customers; partners never see customers outside a support session (USERS-AND-DOMAINS §4). |
| **13 months searchable, then archived to R2 for 7 years** | Forever; 90 days | A full year plus comparison online; long enough for billing disputes, chargebacks and investigations offline; storage and privacy exposure stay bounded. |
| **Technical logs are separate**: Workers Logs and Logpush, no personal data | Mixing request logs into the activity log | Engineers need every request and error; users need a clean history of actions. The request id links the two. |

---

## 2. Three kinds of record

| Record | Holds | Stored in | Seen by |
|---|---|---|---|
| **Activity log** (this document) | Every write, sign-in and security event, attributed to a person or caller | `activity_log` in Postgres | Each viewer within their scope (§6) |
| **Technical logs** | Every request, error, timing and job run; ids and codes only | Workers Logs, then Logpush *(destination open, ARCHITECTURE §8)* | Engineers |
| **Business records** | Jobs, publish runs, AI runs, billing events | Their own tables (SAAS.md §12) | The consoles, as data |

---

## 3. What is recorded, at each level

Every entry has an `action`: a stable, dotted code (`product.updated`). The lists below are
the categories; each API's resolvers declare their own action codes (§5).

| Level | Who acts | Recorded |
|---|---|---|
| **Admin console** (Admin API) | DripFunnel staff | Sign-in, sign-out, failed sign-in, re-authentication; every write: partner created, approved, sent back, paused, contract set; store suspended, restored, trial extended; job retried or undone; staff invited, role changed, removed, invitation resent or revoked; impersonation started, **extended** and ended (and every action inside it, as the user with the staff member on behalf); setup session started and ended; exports |
| **Partner console** (Platform API) | Partner users | Sign-in, sign-out, failed sign-in; every write: branding, domains, email sender, plans and prices, merchant created, plan changed, trial extended, limit override added or removed, suspended, restored, owner invitation resent, setup step retried, billing status set; team changes; support sessions; submission for approval |
| **Merchant portal** (Store API) | Owner, Manager, Staff, vendors, API keys, apps, support sessions | Sign-in, sign-out, failed sign-in, store switched; every write in every area: products, stock, collections, orders, fulfilments, refunds, customers edited by staff, offers, storefront changes and publishes, settings, people, vendors, approvals, API keys, webhooks, app installs, support access setting |
| **Storefront** (Shop API) | Shoppers | Account created, email verified, sign-in, sign-out, failed sign-in, password reset, password or email changed, address added, changed or removed, order placed, order cancelled or return requested by the shopper, account deleted. **Not** page views, searches or carts |
| **System** | Jobs, webhooks, schedules | Provisioning steps, billing status changes from Stripe, automatic publishes, dunning, retention jobs, with the job or provider as the actor |
| **Security** (any level) | Anyone, or unknown | Failed sign-ins for unknown accounts, rate-limit hits, attempted tenant crossings (ACCESS.md §4), denied authorizations. Visibility: staff only |

**Merchant-portal action codes added 2026-10-02 (#182)**, for what the Store prototype now
designs (ACCESS.md §4, §7.3, §7.5; PLATFORM-PROMPT §5.4): `return.started`,
`return.received`, `return.cancelled`, `refund.issued` (with the owner of the lines),
`refund.overridden` (the store refunding a supplier's lines; the ledger entry is its change),
`supplier.invited` (the access level as its reason; #295), `supplier.access_changed` (the level's before and after), `supplier.shipping_mode_changed`, `supplier.suspended`, `supplier.resumed`,
`supplier.removed` (with the products it hid), `supplier.person_added` (the Owner's "Add a person", the role as its reason), `supplier_team.invited` (the role as its reason), `supplier_team.invitation_resent`, `supplier_team.invitation_revoked`, `supplier_team.role_changed` (the role's before and after), `supplier_team.removed` (a Supplier admin's own team, the supplier's seller on each; #295), `two_factor.enabled`, `two_factor.disabled`,
`two_factor.method_changed`, `backup_codes.generated`, `backup_code.used` (a sign-in entry's
detail, never the code), `person.signed_in`, `person.signed_out`, `person.sign_in_refused`, `person.second_factor_refused` (the reason code, never the code typed), `person.locked`, `person.switched_store`, `person.invitation_accepted` (the store's own log, the role as its reason), `person.password_reset_requested`, `person.password_reset` (never the token or the password), `person.profile_updated`, `person.password_changed`, `person.email_change_requested`, `person.email_changed` (neither address in the entry), `member.invited` (the role as its reason), `member.invitation_resent`, `member.invitation_revoked`, `member.role_changed` (the role's before and after), `member.removed` (#290), `product.created`, `product.updated`, `product.duplicated`, `product.deleted`, `product.shown`, `product.hidden` (one entry per product, the supplier's seller on its own; #293; `product.updated` with reason `kind` for a download's, service's or gift card's own details, #323), `product.licence_keys_added` (the count added, never a key; #323), `asset.uploaded` (the file's type, never its bytes; #293), `collection.saved`, `collection.deleted`, `filter.saved`, `filter.deleted`, `filter.values_merged` (the count merged), `menu.saved`, `catalogue.settings_saved` (the switches as key:on/off), `badge.saved`, `badge.deleted`, `size_chart.saved`, `size_chart.deleted` (#293), `product_story.saved`, `product_story.published`, `product_story.copied` (one entry per product it reached, labelled with the source product's name), `story_block.saved`, `story_block.deleted` (#293), `stock.threshold_set` (the threshold, or default), `warehouse.saved` (including made the default), `warehouse.deleted` (#294), `sessions.others_ended`, `customer.consent_recorded`,
`customer.exported`, `customer.added`, `customer.edited` (the names of the fields that changed, never their values), `customer.tags_changed` (how many, never the tags), `customer.note_changed` (never the note), `customer.consent_recorded` (the state before and after), `customer.groups_changed` (how many), `customer_group.created`, `customer_group.updated` (the name before and after), `customer_group.deleted` (#312), `offer.created`, `offer.updated` (the names of the fields that changed), `offer.paused`, `offer.resumed`, `offer.ended`, `offer.duplicated` (the offer copied), `offer.deleted`, `offer.codes_generated` (how many), `offer.codes_exported` (the run, never a code) (#320), `storefront.template_chosen` (the template's key; whether the words were kept), `storefront.design_requested` (that a request was made and its outcome, never the text), `storefront.published` (the version), `storefront.reverted` (the version gone back to), `storefront.discarded`, `storefront.preview_links_ended` (who ended them, never a link or token), `storefront.change_undone`, `storefront.text_edited` (the language and the key, never the words), `storefront.publish_refused` (the version and the failing check), `storefront.rolled_back` (system actor: the version put back and why), `storefront.baseline_served` and `storefront.core_pinned` (system actor: the core version; #470), `storefront.brand_changed` (the names of the fields that changed, never their values), `storefront.seo_changed`, `custom_domain.connected`, `custom_domain.made_primary`, `custom_domain.removed` (the host; #470), `store.created` (by the partner, or by the new Owner with the reason `signup`, #290), `stores.exported`, `branding.file_uploaded` (the key and the kind),
`impersonation.started`, `impersonation.extended`, `impersonation.ended`,
`staff_session.link_reissued` (never the link), `support_session.started`, `support_session.link_reissued`,
`support_session.ended`, `partner_user.reauthenticated` (never the proof),
`partner_user.invitation_accepted`, `partner_user.password_reset_requested`,
`partner_user.password_reset` (never the token or the password), `access_request.sent`, `access_request.resolved`, `stock.adjusted` (with
the reason), `catalog.import_started`, `catalog.imported` (the products and the matching chosen), `shopify.connect_started`, `shopify.connected`, `shopify.disconnected`, `shopify.approved` and `shopify.callback_rejected` (Shopify's own answer at the callback, logged as the `provider`, with `signature` or `exchange_failed`), `domain.status_changed`, `product.sent_back_for_approval` (the field that caused
it: `name`, `price`, `photos`, or `resubmitted` and `A+ content`; #295), `product.proposed` (a Stock-only supplier's new product), `product.approved`, `product.sent_back` (the reason
the supplier sees), `catalogue.approval_changed` (on or off), `store.languages_saved` (the list), `store.main_language_changed` (before and after), `store.currencies_saved` (each with its mode), `market.saved`, `market.deleted`, `market.fallback_changed`, `product.translated`, `catalogue.translated` (a collection's or filter's; each with the language), `catalogue.names_translated` (the shared option and choice names, with the language and how many), `store.info_saved` (the names of the fields that changed, legal name, address, contact and tax id among them, never their values) (#296), `tax.inclusive_changed` (included or added), `tax_class.saved` (default when made so), `tax_class.deleted`, `tax_zone.saved`, `tax_zone.deleted`, `invoice_settings.saved` (#297), `tax_rate.set` (one category's rate in one zone; #300's review), `product.tax_class_changed` (one entry per product; #298), `product.collections_set` (the hand-picked collections the editor put it in, as a count; #298), `shipping.saved` (the methods on, the free rule and the area), `shipping.area_replaced` (the file's name, how many codes), `courier.connected` (pricing or standby), `courier.disconnected` (which courier prices orders now), `courier.pricing_changed`, `courier.options_saved`, `courier.tested` (each courier's result) (#305), `customer.code_requested` (the channel, never the address), `customer.signed_up`, `customer.signed_in`, `customer.sign_in_failed`, `customer.signed_out`, `customer.password_changed`, `customer.updated`, `customer.address_saved`, `customer.address_removed`, `store.customer_accounts_saved` (the mode) (#308), `order.placed` (by the shopper or a guest), `order.marked_paid` (the way it was paid), `order.cancelled` (`unpaid_transfer` by the system after 3 days), `payment_method.turned_on` (a card provider's keys with the mode as reason, part 3), `payment_method.turned_off` (#309), `payment_method.connect_started`, `payment_method.connect_approved` and `payment_method.connect_failed` (Stripe's answer on the hooks host, by Stripe as provider), `payment_method.connected`, `payment_method.disconnected` (Stripe ending the platform's access, by Stripe), `order.payment_retried` (a new card attempt), `order.paid`, `order.oversold`, `order.licence_keys_short` (by the system: how many keys a paid order still waits for, which the merchant's next keys go to; #323), `gift_card.issued` (the amount, never the recipient or the code; #323), `order.paid_after_cancel`, `order.paid_twice` (an earlier attempt paid too, for a refund) and `payment.amount_mismatch` (once, as the order leaves the sweep for the merchant) (each by the provider that answered), `order.cancelled` with `unpaid` (a card payment not completed in a day, by the system) (#309 part 2), `order.note_added` (a team note on an order, its text as the reason, the store's alone: never a supplier's entry; #310), `order.shipped` (`manual` or `pickup` as the reason), `order.sent_to_store` (a to-store supplier's hand-off) and `order.tracking_added` (each the store's full entry and, on a supplier's part, its thin one; #310 part 2), `order.cancelled` by the store (`shopper`, `store` or `out_of_stock` as its reason) and `orders.exported` (the chip, and only whether there was a search; #310 part 4). The two-factor and backup-code entries carry no secret, code or phone number. **The
entries a supplier may see** (its own refunds, overrides against it, returns and hand-offs on
its parts, filed under its `seller_id`) **carry no free text and no shopper field**: the store's
full entry, with the reason, the note and the customer, is written with `seller_id` null and
store visibility, and a second thin entry for the supplier names only the action, the order
number, the lines and the amount (ACCESS.md §7.3; DATA-MODEL.md §2.2).

**Reads are not logged**, with one exception: every support session logs what it opened,
because the merchant has a right to know what support looked at (ACCESS.md §8). A second
exception: **staff opening a customer's detail page** in the admin console is logged
(`customer.viewed`, staff-only visibility). Staff
impersonation (ACCESS.md §8.1) logs reads the same way, as the user with the staff member
`on_behalf_of`.

---

## 4. The entry

| Field | Holds |
|---|---|
| `id`, `occurred_at` | Opaque id; UTC time |
| `category` | `auth`, `write`, `support`, `system`, `security` |
| `action` | Stable code, e.g. `store.suspended`, `product.updated`, `customer.signed_in` |
| `result` | `success`, `denied`, `failed` |
| `actor_kind`, `actor_id` | `staff`, `partner_user`, `person` (merchant or vendor), `customer`, `api_key`, `app_grant`, `support_session`, `job`, `provider`, `anonymous` |
| `actor_label` | Name and email at the time, so the entry reads well after renames (§8 on erasure) |
| `on_behalf_of` | The real agent: the partner user behind a support session, or the staff member impersonating a user (with the impersonation id). Null for a staff setup session (ACCESS.md §8.2), where the staff member is the `actor` |
| `access_ref` | The support session, impersonation or setup session the action ran under, as an id; null for a person's own session |
| `partner_id`, `store_id`, `seller_id` | The scope the action happened in; null where it doesn't apply |
| `customer_id` | The shopper the action concerns, as actor or subject |
| `target_type`, `target_id`, `target_label` | What was acted on (`product`, `order #1042`, `partner Northstar`) |
| `changes` | For updates: the fields changed, with before and after for non-sensitive fields (§4.1) |
| `reason` | Required where the action needs one (suspend, support session, staff and partner writes to a store's account). For `staff.sign_in_refused` it is the refusal code (§4.2) |
| `api`, `host`, `request_id` | Which API, which host, and the request id that links to technical logs |
| `ip`, `user_agent` | For `auth` and `security` entries only; both shown in full to every staff role, and to nobody outside DripFunnel (decided on #44: viewing one entry is not bulk extraction, so the export leaves the IP out) |
| `visibility` | Lowest audience allowed: `staff`, `partner`, `store`, `self` (§6) |

### 4.1 What never goes in an entry

- Passwords, tokens, API key secrets, session ids, verification codes, payment credentials,
  full card numbers, bank details. A field on the redaction list is recorded as "changed"
  with no values.
- Whole request payloads. Only the changed fields, and only as §4 allows.
- Shopper personal data beyond `customer_id` and `actor_label` (for example, an address
  change records "address changed", not the address).
- The free text of a search. An export's entry records its filter with the search text
  replaced by `searched`, since it is often a person's name or email.

The redaction list lives in `apps/api/src/core/redaction.ts` (in `core/`, so the writer in
`saas/` can use it; built on #15), matched on whole words of the field name, and a test fails
if a field on it appears in any entry.

### 4.2 Why a staff sign-in was refused

Every refused staff sign-in answers the caller identically (CONSOLE-DESIGN A1), so the cause
lives only in the entry's `reason`, as one of a fixed set of codes:

| Code | Meaning |
|---|---|
| `missing_code` | The callback arrived with no authorization code |
| `missing_handshake` | No handshake cookie, so the sign-in did not start here |
| `state_mismatch` | The `state` did not match the one we issued: a forged or replayed callback |
| `bad_claims` | The provider returned claims that failed validation |
| `unknown_subject` | No `staff_user` has that `sso_subject` |
| `staff_suspended` | The staff member is suspended |
| `staff_not_active` | The staff member exists but is not active for another reason (invited) |
| `provider_refused` | The provider rejected the exchange |
| `provider_unconfigured` | No identity provider is wired up (#89) |

They are literals, never interpolated, so an entry cannot carry a subject or an email.

---

## 5. How entries are written

- **By declaration, never by hand.** Every mutation's scope declaration (ACCESS.md §3.1)
  names its action code; the GraphQL layer writes the entry. A mutation without an action
  code fails the structural test.
- **In the same transaction** as the change. If the entry can't be written, the change
  doesn't commit; a rolled-back change leaves no entry.
- **Sign-ins, sign-outs and failures** are written by `auth/`, including the Shop API's
  customer sign-in.
- **Denied** attempts are written with `result = denied` in the same request.
- **Jobs and webhooks** write with `actor_kind = job` or `provider`.
- **Append-only**: the application's database role may insert, never update or delete
  (except the retention job, §8). A test proves it.
- Code lives in `apps/api/src/saas/activity/` (writing and querying),
  `apps/api/src/db/schema/activity.ts` (the row) and `apps/api/src/db/scoped/activity.ts`
  (the SQL, behind the scoped layer like every tenant table). `apps/api/src/auth/activity.ts`
  holds the entry shape and the sign-in entries; the writer is passed in from the
  composition root, since `auth/` sits below `saas/` (api/README.md §4).
- **Built on #15, decided on #33.** A mutation's declaration carries `audit: '<action>'` and
  the schema refuses to build without it, or `unlogged: '<rule>'` naming one of the writes §3 leaves out (`cart`: a shopper's cart, built on #308;
  `payment_return`: a shopper back from paying, whose read-back writes only the settlement, which the provider's
  `order.paid` records, #309); the rule is a closed list in `apis/graphql/scope.ts`, so a new one is a change
  to this section. The entry is written **by the service, inside the
  transaction that makes the change**, because only the service holds that transaction; the
  declaration names the action the mutation records when it does what it is named for, and a
  structural test checks every declared action is one the service writes
  (`saas/partners/service.ts` `partnerAudit`). A mutation records one entry per fact it
  changes: creating a partner and sending its Owner invitation in one call is two entries,
  and the first of two approvals is `partner.approval_recorded`, not `partner.approved`.
- **The table is partitioned by month** (§1). The migration creates the partitions to the end
  of 2027 plus a default one; the retention job (§8) creates later months and drops old ones.
  Nothing is granted on a partition, so rows are reachable only through the parent and its
  policies.
- **Side effects** go in `outbox` in the same transaction (api/README.md §5), through
  `saas/outbox`, with an idempotency key the scoped layer prefixes with the kind and the
  scope. `jobs/queues/outbox-relay.ts` delivers them after commit from a one-minute schedule
  that claims what is due **and has a registered deliverer**; a kind nobody delivers yet waits
  untouched. Each attempt takes a lease, times out, and backs off exponentially to a limit,
  after which the row is marked failed and kept; `delivered_at` makes a replay a no-op. A
  request may insert into the outbox and nothing else. A per-row path fed by a Queue message
  is added by the first effect that needs lower latency than the sweep.

---

## 6. Who sees what

Each API only ever returns entries in its caller's scope; filtering is on the server, like
every other tenant read.

| Viewer | Where | Sees |
|---|---|---|
| **DripFunnel staff** (every staff role) | Admin console › Activity log; Activity tabs on partner and store pages | Everything, including `security` entries, IPs and user agents. Can follow **one person across every store and partner** |
| **Partner user** | Partner console › Settings › Activity log; Activity tab on each merchant | Its own users' actions; staff actions on its partner account and merchants' accounts; support sessions its users opened; account-level events on its merchants (plan, trial, suspension, provisioning). **Never** anything inside a store, or any shopper |
| **Merchant Owner** | Merchant portal › Settings › Activity log | Everything in the store: people, vendors, API keys, apps, support sessions (and what they opened), shoppers' account events and orders |
| **Merchant Manager** | Merchant portal › Store activity (user menu, since Settings is the Owner's); customer page › Activity; own activity | Everything the Owner sees, to read; the export stays the Owner's (below; decided on #184); their own actions |
| **Merchant Staff** | Own activity | Their own actions |
| **Vendor** | Own activity | Their own actions only (decided on #184) |
| **Shopper** | Storefront account › Sign-in activity and order history | Their own sign-ins *(release: decide)*, and the events of their own orders (placed, paid, shipped, return, refund), which is how the storefront's order history is read (DATA-MODEL.md §2.2) |

- **"Own activity"** is a profile screen in every portal: the signed-in person's own
  entries in that scope, so anyone can check what was done under their name.
- Accounts are per partner (ACCESS.md §2), so a person's timeline in a portal covers one
  account. Only staff see across stores and partners, and can find every account with the
  same email.
- **Exports** (CSV) of a filtered view: in the admin console, **Super admin and Engineer on
  call only** (decided on #44); every other staff role sees the control disabled with the
  reason. Partner Owner and Admin, merchant Owner in their portals. Every export is itself
  logged. An admin export has no IP column, caps at 100,000 entries, and its download link
  expires after 1 hour (built on #38: an `export_job` of kind `staff_activity`, ending as too
  large rather than as a partial file past the cap). **A partner export (built on #198)** is an `export_job` row
  (DATA-MODEL §2.6): queued through the outbox and built in the partner's own scope, so this
  section's policy decides what it holds. It caps at 10,000 entries (saying when it was cut),
  has no IP or user-agent column, and its CSV is readable for 1 hour after it's built, then deleted
  (the request itself stays in the log as `activity.exported`).
  A **report** export (built on #200) holds no log entries, only account-level totals, so every
  partner role may ask for one (ACCESS §5.3 `exports`); it is logged as `report.exported`.
  A store's **product or stock export** (built on #301) is a `catalog_export` row (DATA-MODEL
  §7.10) built the same way in the asker's scope, so a supplier's holds its own rows; it caps at
  10,000 rows, its CSV is readable by the asker for 1 hour, and the request is logged as
  `catalog.exported` with any search text replaced by `searched`.

---

## 7. Searching and filtering

The same log screen in all three portals, fed by each app's API. The component lives in
`apps/ui/admin/src/features/common/` until a second **portal** needs it, then moves to
`apps/ui/shared/` (decided on #44); the admin console's screen is FIRST-RELEASE.md §9.

- **Filter by person first**: a typeahead over the people in the viewer's scope (staff,
  partner users, merchants, vendors, shoppers). Choosing one shows that person's timeline.
- **Other filters**: actor kind, category, action, result, target (type and id), store,
  partner, vendor, date range. Staff also: IP. Every filter is in the URL, so a filtered view
  can be bookmarked and shared.
- **Search box** over actor and target labels ("Priya", "order 1042", "Northstar").
- **Newest first**, keyset pagination (never page numbers over millions of rows).
- **Every name is a link**: clicking a person opens their timeline, clicking a target opens
  its page (with its own Activity tab).
- **An entry expanded** shows the changes (before and after), the reason, the session or
  support agent, and for staff the request id.
- **Plain words** (the Platform API returns the code and its facts, and the partner console
  words them, built on #198): each action code has a message per locale ("Priya suspended Mehta
  Textiles: chargeback"), never the raw code. The codes so far are listed in
  `apps/ui/admin/src/api/activityActions.ts`, the draft contract offered to #38.

**Indexes** (declared on the parent, so per monthly partition; built on #15): each of
`(actor_kind, actor_id)`, `(store_id)`, `(partner_id)`, `(customer_id)`,
`(target_type, target_id)` and `(action)` followed by `(occurred_at desc, id desc)`, plus
`(occurred_at desc, id desc)` alone for the unfiltered page. The keyset cursor is the pair
`(occurred_at, id)`, opaque to the client, and every page also bounds `occurred_at` so the
planner prunes partitions. Trigram indexes on `actor_label` and `target_label` for the search
box *(decide)*. Row-level security per §6, not only on `store_id`: a partner reads entries with
`visibility = partner` in its partner; a store reads `store` and `self` entries in its store and
the `partner` ones that name it (account-level events: plan, trial, suspension, provisioning);
a supplier only those under its `seller_id`; a shopper only their own `customer_id`.

---

## 8. Retention, archive and erasure

- **13 months searchable**: partitions older than 13 months are exported by a monthly Cron
  job to compressed files on R2 (one per month, `activity/YYYY-MM`), verified, then dropped.
- **7 years in the archive**, then deleted. Staff can restore a month for an investigation;
  restoring is logged.
- **Erasure requests** (GDPR, DPDP): a deleted shopper, merchant person or partner user is
  **pseudonymised**: their `actor_label` becomes "Deleted user" and their personal fields in
  entries are cleared; ids stay, so the history of what happened stays intact. Archive files
  hold ids and codes only, never labels, so they need no rewriting *(confirm)*.
- A closed store's entries follow the store's retention window (SAAS.md §4.2), then the same
  archive rules.
- **The outbox** (decided on #15): its payload is what a deliverer needs and may hold an
  address, so the same retention job deletes delivered rows after 30 days and failed ones after
  90, and an erasure request clears the payload of any row that names the person. Nothing is
  archived from it.

---

## 9. Technical logs

- Structured JSON from the Worker: request id, API, host, partner, store and seller ids,
  status, duration, error code. **No personal data, no payloads.**
- Workers Logs for recent search; Logpush for long-term storage *(destination open)*.
- The activity entry's `request_id` links a user's action to its technical trace.
- An error names what failed as a class and a SQLSTATE or system code (`PostgresError:28P01`),
  never its message. `sign_in_unavailable` is an outage during the staff sign-in (the browser
  lands on the sign-in screen's unavailable state, and no refusal is recorded);
  `request_failed` is an error nothing caught, answered as a plain 500; `db_ping_failed` and
  `db_health_check_failed` are the health check's probe and its connection. Email (#274):
  `email_sent`, `email_skipped` (`link_closed`, `no_recipient`, `suppressed`, `held`, and `tenant_mismatch` when the payload's store or partner isn't the outbox row's),
  `email_refused` with SES's error type, and `ses_event` for the bounce hook. Never an address.
- **Credentials in a URL, in its path or its query, are never logged:**
  - the studio frame's session id (storefront AI-STUDIO §8) is written as `/__studio/:session/…`;
  - the preview link's token (storefront PREVIEW §5 step 2) is written as `/__open?t=:token`;
  - the edge Worker's automatic invocation logs are off;
  - the `webpreview.store` zone's request logs leave out the request path and query
    (`ClientRequestURI`, `ClientRequestPath`, `ClientRequestQuery` are not among its Logpush
    fields).

  A logging test fails if either value appears in a log line.

---

## 10. Testing

- **Structural**: every mutation declares an action code; nothing on the redaction list
  appears in any entry; the application role can't update or delete entries.
- **Transactional**: a rolled-back change leaves no entry; a failed entry write rolls back the
  change.
- **Isolation**: log queries join the isolation matrix (ACCESS.md §11): a partner never sees
  another partner's entries or any shopper entry; a vendor sees only their own; a merchant
  never sees another store's.
- **Coverage**: one test per level that performs a sign-in and a write and finds both entries.

---

## 11. Open questions

- ~~May Managers see the whole store log, or only customers' activity and their own?~~ **Settled
  2026-10-04** on #184 (§6): the whole store log.
- ~~Do vendors see their own actions (proposed), or nothing?~~ **Settled 2026-10-04** on #184 (§6):
  their own.
- Do shoppers get a "Sign-in activity" screen in their storefront account, and in which
  release?
- IP addresses: kept for 13 months for `auth` and `security` entries, staff-only (proposed),
  or truncated?
- Free-text search: Postgres trigram indexes, or full-text search?
- Archive format on R2 (compressed JSON lines or Parquet), and who may restore.
