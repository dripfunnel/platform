# AUTH-PLAN.md

Auth, invitations, role management and vendor access for the DripFunnel merchant portal BFF.

Companion to [SAAS-PLAN.md](SAAS-PLAN.md) (what the platform becomes) and [ARCHITECTURE.md](ARCHITECTURE.md) (how this repo is built) — this expands SAAS-PLAN §8 ("Merchant Portal and BFF") into an implementable design for one slice: **who can sign in, how they get an account, and what they are allowed to do**. Catalog, orders, AI runs and billing stay in the main plan.

**Status: proposed. None of this is implemented yet.**

Last updated: 2026-09-13.

---

## 0. Scope

In scope:

- Merchant and vendor authentication, and session handling in the BFF
- The role model: fixed templates cloned per channel — **the portal never creates roles**
- Inviting users into a tenant with a role
- Vendors: a `Seller` per vendor **inside the merchant's own channel**, with products tagged by `sellerId` (§8)
- Forgot-password / password-set flows

Out of scope: DripFunnel staff auth (they keep the Vendure Dashboard), shopper auth (Shop API), API keys.

Four rules constrain everything below — the first two inherited from [SAAS-PLAN.md](SAAS-PLAN.md):

- **The tenant boundary is the Vendure `Channel`.** No parallel tenant entity.
- **The browser never holds a Vendure admin token.** All Vendure traffic goes through the BFF.
- **The BFF never creates or edits roles.** It clones fixed templates at provisioning and assigns them from a dropdown.
- **Vendor separation is enforced by the BFF, not by Vendure.** There is no vendor channel. This is the decision with the widest blast radius in this document — §2.6 and §8.2 explain exactly what it costs.

---

## 1. What already exists

Verified against the running Admin API and the backend source (2026-09-12/13). Do not rebuild these.

| Capability | Where | Notes |
|---|---|---|
| `login(username, password, rememberMe)` | core | Returns `CurrentUser` with `channels[] { id, token, code, permissions }` |
| `logout()`, `me`, `activeAdministrator` | core | `me.channels` is how the BFF learns tenancy — §3 |
| `createAdministrator`, `updateAdministrator` | core | `password` is **required** — no passwordless creation |
| `createRole`, `roles`, `role` | core | `roles` listing **is** visibility-filtered |
| `createSeller`, `sellers`, `seller` | core | `Seller` is just `{ id, name, customFields }` — used here as vendor identity only (§8.1) |
| `addFulfillmentToOrder(lines: [{orderLineId, quantity}])` | core | Partial fulfilment by line — what makes §8.5 possible |
| `requestAdministratorPasswordReset` / `resetAdministratorPassword` | [`AdminPasswordResetPlugin`](https://github.com/SoftoboticsTechnologies/vendure-backend/blob/main/src/plugins/admin-password-reset/api/admin-auth.resolver.ts) | `@Allow(Public)`, deliberately non-enumerable |
| Unauthenticated SPA routes for reset | same plugin, `ui/` | `authenticated: false` dashboard routes |
| Role duplication | `DuplicateRolePlugin` | Pure UI over `createRole` — the shape §5.2 needs server-side |

**Deliberately not used:** `Channel.seller` / `CreateChannelInput.sellerId` and `OrderSellerStrategy` (`Order.sellerOrders`, `aggregateOrder`). These are Vendure's native marketplace primitives, and they are all keyed on *channel*. With one shared channel they do not apply — see §2.7.

`tokenMethod` is `['bearer', 'cookie']`, so bearer works with no backend change.

---

## 2. Constraints discovered

Facts the design bends around. Each verified, not assumed. **Read this before reviewing anything below.**

### 2.1 `Administrator` is not channel-scoped — and listing it is not filtered

`Administrator` has no `channels` field. `AdministratorService.findAll()` applies only `deletedAt IS NULL` — no channel filter, no visibility check:

```js
findAll(ctx, options, relations) {
    return this.listQueryBuilder
        .build(Administrator, options, {
            relations: relations ?? ['user', 'user.roles'],
            where: { deletedAt: IsNull() },
            ctx,                       // ← no channelId, no permission filter
        })
```

`RoleService.findAll()` right beside it *does* compute `visibleRoleIds` per channel first.

**Consequence: anyone holding `ReadAdministrator` can list every administrator on the platform.** No merchant- or vendor-facing role may contain any Administrator permission (§5.3), and "list the users in my tenant" needs a new server-side query (§6.2).

### 2.2 Core requires a password to create an Administrator

`CreateAdministratorInput.password` is non-null. There is no pending-user concept in core. Any invite must supply *some* password at creation. Drives §7.

### 2.3 Vendure's privilege-escalation guards go inert behind a service account

`AdministratorService.checkActiveUserCanGrantRoles()` (on create *and* update) and `RoleService.getPermittedChannels()` / `checkActiveUserHasSufficientPermissions()` are real guards — and all key off `ctx.activeUserId`. **Behind a service account they evaluate against an identity that holds everything, and all pass.** Delegating to a service account discards Vendure's protection rather than inheriting it. The BFF re-implements the equivalent checks (§9).

### 2.4 `Role.code` has no unique constraint

A plain `@Column()`. Cloned per-channel roles collide unless namespaced, and the database will not catch it. See §5.2.

### 2.5 Template roles on the default channel would be a cross-tenant leak

`ChannelService.assignToCurrentChannel()` assigns every entity to `ctx.channelId` **and the default channel**, so the default channel sees every tenant's data. A template Role row scoped to the default channel would grant its permissions platform-wide the moment anyone was assigned it. Mitigation in §5.1: templates live on a dedicated, permanently empty channel and are never assigned to a user.

### 2.6 Vendure permissions are per-channel, never per-row

This is the central constraint of the vendor design. `ReadProduct` is "read products **in this channel**" — there is no mechanism anywhere in Vendure for "read *these* products". With vendors sharing the merchant's channel, **every vendor's role permits reading and writing the merchant's entire catalogue, including other vendors' products.** Nothing in Vendure narrows it.

The separation therefore exists only in the BFF: it filters reads by `sellerId` and validates writes against it. That is a real boundary as long as the BFF is the only way in — which is what §8.2 exists to guarantee.

### 2.7 Order splitting requires channels

`SplitOrderContents` is keyed by `channelId`, and `OrderSellerStrategy.setOrderLineSellerChannel()` returns a `Channel`. Both are channel-based, so with one shared channel there are no `sellerOrders` and no `aggregateOrder`. A vendor's order view has to be constructed by the BFF (§8.5); no Order record will ever belong to a vendor.

### 2.8 Relation custom fields cannot be filtered

Vendure builds filter parameters from:

```js
const filterableFields = customEntityFields.filter(
    field => field.type !== 'relation' && field.type !== 'struct');
```

So a `relation` custom field pointing at `Seller` **would not appear in `ProductFilterParameter`**, and the BFF would have to fetch the whole catalogue and filter in memory. `sellerId` must therefore be a **scalar** custom field (`string`). Scalar custom fields are added automatically — that is why `seoTitle`, `seoDescription` and `seoTags` already appear in `ProductFilterParameter` today.

The same applies to `approvalStatus` (§8.4) and to `Administrator.customFields.sellerId`.

### 2.9 The invite email that exists today never sends

`adminPasswordChangedHandler` is imported in `vendure-config.ts` (line 27) but is **not** in `EmailPlugin.init({ handlers: [...] })` — only `adminPasswordResetHandler` is. Meanwhile the dashboard UI promises: *"You'll receive an email with your new password once it's saved."* That email does not exist (the backend's CLAUDE.md lists it under "Known discrepancies"). §7 supersedes the flow — decide deliberately: register the handler, or remove the plugin and its promise.

### 2.10 The password-reset link points at the Dashboard, for everyone

`adminPasswordResetUrl` is a single `globalTemplateVars` value resolving to `${ADMIN_DASHBOARD_URL}/reset-password`, computed once per server. Merchants and vendors must land in the **portal**. The audience decision moves into the email handler, which can see the user's roles and channels (§7.4).

### 2.11 Session and cache timings are wrong for a portal

Defaults apply — none are overridden in `vendure-config.ts`:

| Setting | Default | Problem |
|---|---|---|
| `sessionDuration` | `1y` | A year-long session is not acceptable for a paid portal |
| `sessionCacheTTL` | `300` (5 min) | **Permission changes take up to 5 minutes to apply** — including suspending a vendor |
| `verificationTokenDuration` | `7d` | Also governs password-reset tokens; no separate reset TTL |

### 2.12 Administrator custom fields are global, not per-channel

`Administrator` has no channel relation (§2.1), so its custom fields are columns on one row: **one value per person, platform-wide**. There is no per-channel variant and no way to add one without a new entity.

This is what stops vendor identity living there once a user may belong to several marketplaces (§3.1). It also limits what the backend request guard can know about a user, which is why that guard uses a deliberately coarse flag (§8.2).

---

## 3. Identity model

```
Vendure User ── 1:1 ── Administrator          one account per person, platform-wide
      │
      └── n:m ── Role ── n:m ── Channel       a user may hold roles in MANY channels

BFF: membership(admin_id, channel_id, seller_id)   ← vendor identity is per (user, channel)

Product ──(customFields.sellerId)──▶ Seller        null ⇒ the merchant's own product
```

A person has **one** account and may belong to several marketplaces at once — staff at one, a vendor at another, a vendor at three. `Administrator.emailAddress` is globally unique, and that is now the point rather than the obstacle it used to be: the same person is the same account everywhere, and joining another marketplace adds a role, not an account.

Tenancy is a property of the user's roles. **Vendor identity is a property of the pair (user, channel)** — never of the user alone.

### 3.1 Why vendor identity cannot live on the Administrator

`Administrator.customFields` holds one value per user, platform-wide (§2.12). A `sellerId` there would force the same vendor identity in every marketplace the user belongs to, and would have no answer at all for someone who is a vendor in one and merchant staff in another. So the mapping lives in the BFF database:

```
membership(admin_id, channel_id, seller_id NULL, created_at)
   seller_id IS NULL  ⇒ merchant staff in that channel
   seller_id SET      ⇒ vendor in that channel, acting as that Seller
```

Vendure remains the authority on *permissions* — the roles on each channel. The membership row adds only the seller identity Vendure has no concept of, plus the list the portal switches between.

**One thing must stay in Vendure**: the request guard (§8.2) runs inside the backend and cannot read the BFF database, so it needs a coarse marker to know whether to demand the proof header. `Administrator.customFields.requiresBffProof` is set true when the user is a vendor in **any** channel. It is deliberately conservative: such a user must always come through the BFF, even for a marketplace where they are staff. Merchants and vendors are not Dashboard users anyway (§11).

### 3.2 Choosing the acting channel

The session holds the user's whole membership set, resolved at login from `me.channels` intersected with the membership table. **Each request names the channel it is acting in, and the BFF checks that channel is in the session's set.**

That is an authorization check against a server-held allowlist, not trust in client input — the distinction matters, because the alternative (one "active channel" stored on the session) makes two browser tabs on two marketplaces fight each other, which is exactly what a user with several marketplaces will do on day one.

Everything else still comes from the server: once the acting channel is validated, its channel token, permission set and `seller_id` are all looked up, never accepted from the request.

**Invariants:**

- Every channel in `me.channels` must be a known tenant channel, and **the default channel must never appear**. Either means a provisioning or invite bug; fail closed and alert.
- The acting channel must be in the session's membership set — checked on every request, not at login only.
- `sellerId` is derived from `(session, acting channel)`. A client-supplied `sellerId` anywhere is a vendor-impersonation bug.

### 3.3 Custom fields this adds

| Entity | Field | Type | Purpose |
|---|---|---|---|
| `Administrator` | `requiresBffProof` | boolean | True if the user is a vendor in any channel — the guard's coarse check (§3.1, §8.2) |
| `Product` | `sellerId` | string (scalar, §2.8) | Null ⇒ the merchant's own product; set ⇒ that vendor's |
| `Product` | `approvalStatus` | string (`pending`/`approved`/`rejected`) | Only meaningful when the merchant requires approval (§8.4) |
| `Channel` | `vendorProductsRequireApproval` | boolean | Per-merchant setting (§8.4) |

All scalar, so all filterable (§2.8). `Product.sellerId` is the id of a `Seller` row; the BFF resolves names via `sellers` rather than through a relation.

No `channelType` or `parentChannelId` — there are no vendor channels to classify.

---

## 4. Session design

```
Browser ──(httpOnly cookie: df_session)──▶ BFF ──(Authorization: Bearer <vendure token>)──▶ Vendure
                                            │       (vendure-token: <channel token>)
                                            │       (X-DF-BFF-Proof: <HMAC>)  ← §8.2
                                            └── server-side session store
```

**Login.** Browser posts credentials to the BFF. The BFF calls `login`, reads the bearer token from the response header and `me` from the body, applies the §3 invariants, loads the user's membership rows, creates its own session, and returns only an opaque `df_session` cookie — `httpOnly`, `Secure`, `SameSite=Lax`.

The session record holds: Vendure session token, user id, timestamps, and **the membership set** — for each channel the user belongs to, its id, channel token, permission set and `seller_id`. None of it reaches the browser.

If the set has one entry the portal goes straight in; if several, the user picks a marketplace (and the portal may remember the last one as a *client-side convenience only* — the server still validates every request against the set).

**Every request.** Look up the session, read the acting channel named by the request and **check it is in the session's membership set** (§3.2), check subscription state for *that* channel (SAAS-PLAN §10), then inject `Authorization`, `vendure-token` for that channel, and the §8.2 proof header. Everything injected comes from the session row, never from the request body.

A request naming a channel the session does not hold is not a 404 — it is an attempted tenant crossing. Log it with both channel ids and the user, because it is either a client bug or someone probing.

**Logout.** Delete the BFF session *and* call Vendure `logout()`. Dropping only the cookie leaves a live Vendure token in the store. Logout is global across marketplaces — there is one session and one Vendure token behind it, not one per membership.

**Timings** (do not inherit §2.11): BFF session idle 2h / absolute 12h; `rememberMe` extends the absolute bound rather than removing it. Set `authOptions.sessionDuration` to something bounded (e.g. `7d`).

---

## 5. Role model

**The portal has no role editor.** Roles are fixed templates, cloned per channel at provisioning. Assigning a role is a dropdown of roles already cloned for that channel. Nothing calls `createRole` outside provisioning; nothing ever calls `updateRole`.

### 5.1 Templates live as Role rows on an empty channel

A dedicated `__role-templates` Channel holds one Role row per template. It contains no products, orders or customers, and no user is ever assigned a role on it — so even a mis-assignment grants permissions over nothing (§2.5). Editing a template changes what *future* clones receive and deliberately does not touch existing tenants. Worth a startup assertion that the channel is empty.

### 5.2 Cloning at provisioning

```
createRole({
  code: `tenant:<channelToken>:<templateKey>`,   // namespaced — Role.code is not unique (§2.4)
  description: "<human label shown in the dropdown>",
  permissions: <template.permissions>,
  channelIds: [<the merchant channel id>],
})
```

**Store the resulting role ids on the tenant record in the BFF's own database.** Re-deriving them by matching codes at invite time is how tenants end up cross-wired.

### 5.3 The templates

All six are cloned into the **merchant's channel** — vendors included, since there is no vendor channel.

| | Owner | Manager | Staff |
|---|:--:|:--:|:--:|
| Read catalog | ✓ | ✓ | ✓ |
| Write catalog | ✓ | ✓ | |
| Read orders & customers | ✓ | ✓ | ✓ |
| Write orders & customers | ✓ | ✓ | ✓ |
| Promotions | ✓ | ✓ | |
| Payment & shipping config | ✓ | | |
| Invite users, manage vendors, publish storefront | via service account (§5.4) | | |

Vendor tiers — the "access level" the merchant picks per vendor, changeable later (§8.6):

| | Vendor · Catalogue | Vendor · Orders (read) | Vendor · Orders (fulfil) |
|---|:--:|:--:|:--:|
| Read + write catalog | ✓ | ✓ | ✓ |
| `ReadOrder` | | ✓ | ✓ |
| `UpdateOrder` | | | ✓ |

**Read those vendor ticks honestly.** Because permissions are per-channel (§2.6), "read + write catalog" grants the vendor the *whole merchant catalogue* at the Vendure layer. The table describes what the **portal** exposes, and the portal is the only door (§8.2). It is not a Vendure-enforced boundary, and nobody should read it as one.

**Never in any merchant or vendor role:**

- `SuperAdmin` — unassignable via `createRole` anyway.
- `UpdateChannel` — SAAS-PLAN §8 trap 1: gates `publishChannel` but also permits editing *any* Channel field, including `githubTokenSecretRef` and (now) `vendorProductsRequireApproval`.
- `UpdateGlobalSettings` / `ReadGlobalSettings` — SAAS-PLAN §8 trap 2: global across tenants.
- **Any `Administrator` permission, including `ReadAdministrator`** — §2.1.
- Any `Role` permission — the portal has no role editor by design.
- `Seller` permissions — vendors must not read or edit the Seller list; the BFF manages those with the service account.

### 5.4 Operations the BFF performs with a service account

Invites and user management, vendor creation, approval-state changes, `publishChannel`, and later billing and domains. Each needs its own BFF-side check (§9) — §2.3 is why Vendure's guards no longer help.

---

## 6. Backend changes required

### 6.1 `AdminInvitePlugin`

```graphql
input InviteAdministratorInput {
  emailAddress: String!
  firstName: String!
  lastName: String!
  roleIds: [ID!]!
  sellerId: String          # set ⇒ this is a vendor user
}

type AdministratorInviteError { errorCode: String!, message: String! }
union InviteAdministratorResult = Administrator | AdministratorInviteError
union AcceptAdministratorInviteResult = Success | AdministratorInviteError

extend type Mutation {
  inviteAdministrator(input: InviteAdministratorInput!): InviteAdministratorResult!
  resendAdministratorInvite(administratorId: ID!): InviteAdministratorResult!
  revokeAdministratorInvite(administratorId: ID!): Success!
  "Public — the token is the credential."
  acceptAdministratorInvite(token: String!, password: String!): AcceptAdministratorInviteResult!
}

extend type Query {
  "Administrators whose roles are scoped to the current channel. Exists because the core `administrators` query is not channel-filtered."
  channelAdministrators(options: AdministratorListOptions): AdministratorList!
}
```

New `Administrator` custom fields: `inviteStatus` (`pending`/`active`/`revoked`), `invitedAt`, `invitedByAdministratorId`, `sellerId` (§3.1).

### 6.2 `channelAdministrators`

Filters on `administrator → user → roles → channels` containing `ctx.channelId`, excluding the default channel so platform staff never appear in a tenant's list. Required because of §2.1. Note it returns **merchant staff and vendor users together** — they share a channel now — so the BFF splits them by `sellerId` for display.

### 6.3 `BffGuardPlugin` — see §8.2

The guard that makes vendor separation real. Described there because it only makes sense alongside the threat it addresses.

### 6.4 Also fix, while in here

- Register `adminPasswordChangedHandler`, or delete the plugin and its UI promise (§2.9).
- Make reset/invite email URLs audience-aware (§2.10, §7.4).
- Set `authOptions.sessionDuration`; consider lowering `sessionCacheTTL` (§2.11).

---

## 7. Inviting a user

### 7.1 Why not email a generated password

Today's mechanism (generate a random password, email it) puts a working credential in an inbox with no expiry and nothing forcing a change. The flow below reuses the password-reset primitives already here, so the invitee chooses their own password and the emailed secret is single-use and time-bounded.

### 7.2 Sequence

```
Portal: "Invite user" (email, name, role from dropdown [, vendor])
   │
   ▼
BFF ─ validates: caller may invite (§9), role ∈ this channel's cloned roles, not already a member HERE
   │
   ▼  service account + vendure-token: <channel>
inviteAdministrator(input)
   │
   ├─ 1. re-validate every roleId is scoped to ctx.channelId        ← defence in depth
   ├─ 2. does an Administrator already exist for this email?
   │        yes ⇒ JOIN path:  assign the role, write the membership row, skip 3–5
   │        no  ⇒ createAdministrator(password: <32 bytes CSPRNG, never disclosed, never stored>)
   ├─ 3. requiresBffProof = true if this is a vendor invite
   ├─ 4. UserService.setPasswordResetToken(ctx, emailAddress)
   ├─ 5. customFields.inviteStatus = 'pending'
   ├─ 6. BFF: membership(admin_id, channel_id, seller_id) row
   └─ 7. publish AdministratorInvitedEvent
               │
               ▼
        email handler → ${PORTAL_URL}/accept-invite?token=…
   │
   ▼
acceptAdministratorInvite(token, password) → resetPasswordByToken → inviteStatus = 'active'
```

Step 2's throwaway password exists only to satisfy core's non-null `password` (§2.2). Generated, passed, discarded — never logged, persisted or emailed. Steps 2–7 are one transaction; a half-created administrator with no token, or a role with no membership row, is a support ticket the portal cannot resolve.

**The JOIN path must not leak account existence.** Since users span marketplaces (§3), inviting someone who already has a DripFunnel account is now a normal outcome rather than an error — but the portal must respond identically either way ("invite sent"), or a merchant can probe which email addresses have accounts on the platform. The existing user gets an email saying they have been invited to *this* marketplace; they already have a password, so the link takes them to the marketplace rather than to a password form. Never render "that user already exists" in the UI.

### 7.3 Lifecycle

- **Resend** — mint a fresh token; the previous one stops working (`setPasswordResetToken` overwrites).
- **Revoke** — soft-delete the Administrator and set `inviteStatus = 'revoked'`.
- **Expiry** — `verificationTokenDuration`, 7d (§2.11). Show pending invites with expiry and offer resend.
- **Already a member here** — the only genuine error. Core's `checkForDuplicateEmailAddress` also throws for an account that exists *elsewhere* on the platform, which is now the ordinary JOIN path (§7.2), so the BFF must tell those two apart by checking membership for this channel before it calls Vendure at all.
- **Leaving a marketplace** — revoking a user removes the role and the membership row for *that* channel only. The Administrator survives if they belong to others; delete the account only when the last membership goes.

### 7.4 Email routing

Invite and reset emails must link to the portal, not the Dashboard (§2.10). Since `adminPasswordResetUrl` is global, the handler resolves audience from the user's roles → channels: default channel ⇒ staff ⇒ Dashboard; tenant channel ⇒ portal. Add `portalUrl` to `globalTemplateVars`.

---

## 8. Vendors

A vendor supplies products that the merchant sells. There is **no vendor channel** — a vendor is a `Seller` row, their users are Administrators in the merchant's channel carrying `sellerId`, and their products are ordinary products in the merchant's catalogue tagged with the same `sellerId`. The merchant sees everything; a vendor sees only their own.

### 8.1 `Seller` is identity only

`Seller` is `{ id, name, customFields }` — no channel link, no hierarchy. It exists here purely so "vendor" is a first-class row that products and users can point at, and so vendor names survive independently of user accounts. `Channel.seller` is **not** set (§1).

Creating a vendor is therefore cheap: `createSeller`, then invite its first user with that `sellerId` (§7.2). No channel, no repo, no build, no billing record — which is the main advantage of this model over a channel-per-vendor one.

### 8.2 The BFF proof guard — what makes any of this a boundary

Because permissions are per-channel (§2.6), a vendor's Vendure role grants them the merchant's whole catalogue. The portal filters that down, but **`login` is a public Admin API mutation** — a vendor knows their own email and password, and `store.dripfunnel.com/admin-api` and `/dashboard` are reachable from the internet. Without a guard, a vendor can authenticate directly, skip the BFF, and read and edit everything in the merchant's channel.

Per the decision to keep real permissions, close it with a request-level guard in a Vendure plugin:

- Every Admin API request carries `X-DF-BFF-Proof`: an HMAC over `(method, path, timestamp, nonce)` with a shared secret, timestamp-bounded to a small window so a captured header cannot be replayed.
- The guard resolves the requesting user. **If `Administrator.customFields.requiresBffProof` is true and the proof is absent or invalid, reject.** DripFunnel staff are unaffected, so the Dashboard keeps working.
- That flag is deliberately coarse (§2.12, §3.1): the guard runs in the backend and cannot read the BFF's membership table, so it cannot know *which* marketplaces this user is a vendor in. It therefore treats anyone who is a vendor **anywhere** as BFF-only, everywhere. Slightly over-broad, and correct in the direction that matters.
- Reject at `login` too, not only on subsequent requests — a vendor should never obtain a session token outside the BFF.
- **Fail closed.** If the guard cannot determine whether the user is a vendor, deny. A guard that defaults to allow is not a guard.

Residual risks, stated plainly rather than buried:

- The shared secret is a single credential protecting every merchant's catalogue from every vendor. Leaking it re-opens the hole for all tenants at once. Rotate it, keep it out of the storefront build and out of any client bundle, and treat it like a signing key.
- The guard runs on **every** Admin API request, so it is on the hot path for staff and merchants as well. Resolve the user from the existing session cache rather than adding a query.
- It protects the Admin API only. Anything else that ever reads products with an authenticated identity — the REST product import/export endpoints (SAAS-PLAN §8, exception 1), future webhooks — needs the same check, or it becomes the bypass.

The safer alternative was giving vendors no Vendure permissions at all and letting the BFF hold all authority; that was considered and not chosen. Recording it here so the trade-off is visible when this is reviewed.

### 8.3 Product ownership

- Vendor creates a product ⇒ BFF sets `customFields.sellerId` from the membership row for **`(session, acting channel)`**, never from the payload (§3.2).
- `sellerId == null` ⇒ the merchant's own product. Vendor list queries always filter `sellerId eq <that membership's seller_id>`, so nulls never match.
- A user who is a vendor in several marketplaces has a **different `seller_id` in each**. Resolving it from the user rather than from `(user, channel)` would show them another marketplace's products — the single likeliest way to get this wrong.
- Merchant list queries apply no seller filter, and the portal shows the vendor name resolved from `sellers`.
- The merchant may edit any product, vendor-owned included.
- **A vendor may never change a product's `sellerId`.** The BFF strips it from every vendor update; otherwise a vendor can reassign a product to themselves or orphan one.

Variants have no `sellerId` of their own — that would duplicate state and drift. Variant-scoped queries resolve ownership through the parent product.

### 8.4 Approval is a per-merchant setting

`Channel.customFields.vendorProductsRequireApproval` decides the behaviour for that merchant:

- **Off** — a vendor's product is created enabled and reaches the storefront immediately.
- **On** — the BFF forces `enabled: false` and `approvalStatus: 'pending'` at creation, regardless of what the vendor sent. The merchant's review queue is a list filtered on `approvalStatus eq 'pending'`; approving sets `approved` and enables the product.

Both paths need the same defence: a vendor holds `UpdateProduct` on the channel (§2.6), so **the BFF must strip `enabled` and `approvalStatus` from vendor-supplied input** rather than merely not showing the controls. Sanitising writes matters as much as filtering reads.

Open question worth settling early: when a vendor edits an already-approved product, does it revert to `pending`? Left as a decision in §11.

### 8.5 Orders are a BFF-constructed view

No Order ever belongs to a vendor (§2.7). The BFF builds the view:

- **Read** — fetch the order, keep only lines whose product carries the vendor's `sellerId`, and recompute line-level totals for display. Order-level totals (shipping, discounts, tax) span sellers and cannot be honestly attributed to one vendor; show the lines, not a fabricated order total.
- **Fulfil** (top tier only) — `addFulfillmentToOrder` accepts a subset of lines, so a vendor can fulfil just theirs. The BFF must verify **every** `orderLineId` in the request belongs to that vendor before forwarding. This is the highest-risk write in the whole design: the vendor holds `UpdateOrder` on the channel, so a missed check means they can modify any order in the merchant's store.
- **Customer data** — a vendor shipping directly needs a delivery address, which is personal data belonging to the merchant's customer. Decide what a vendor may see (name and address but not email/phone is the usual answer) and apply it in the BFF's serializer, not in the UI.

Refunds, cancellations and returns spanning multiple sellers are **not** designed here. They belong in SAAS-PLAN alongside payments, and they are the strongest argument for revisiting channel-per-vendor if vendor order handling grows beyond simple fulfilment.

### 8.6 Vendor lifecycle

- **Create** — `createSeller`, then §7.2 invite with that `sellerId` and one of the three vendor roles.
- **Change access level** — assign a different cloned role to the vendor's users. No role is edited (§5). Takes up to `sessionCacheTTL` (5 min) to bite (§2.11); the BFF should also drop its own sessions for those users so a downgrade is immediate where it can be.
- **Suspend** — revoke the users; the products stay, tagged with the seller.
- **Remove** — decide what happens to their products. They already sit in the merchant's catalogue, so leaving them is probably right, but the merchant then owns products no vendor maintains. See §11.

---

## 9. BFF-side authorization

Behind a service account Vendure's guards are inert (§2.3), and for vendors Vendure enforces nothing at all (§2.6). **This module is the entire boundary.** It belongs in one place every privileged path calls.

1. **Session is valid**, and **the acting channel is in the session's membership set** (§3.2). This is now check zero: a user may belong to several marketplaces, so every request has to prove which one it is acting in and that the user belongs to it.
2. **The acting user holds the portal capability** — invite, manage-vendors, approve and publish are Owner-only, **evaluated for the acting channel**. Someone may be an Owner in one marketplace and a vendor in another; a capability check that forgets the channel grants the wrong one. These are BFF concepts; the templates carry no Administrator permissions.
3. **Every target role id is one of the roles cloned for this channel** — by stored id, never by code (§2.4), never from client input.
4. **The target user is in this channel** — via `channelAdministrators`, not by trusting a request id.
5. **`sellerId` comes from the membership row for `(session, acting channel)`** — not from the user, and never from the payload, which is stripped (§3.2, §8.3).
6. **Vendor reads are filtered** by `sellerId` on every path — product list, product by id, variants, assets, search, CSV export. A single unfiltered endpoint exposes the whole catalogue.
7. **Vendor writes are validated** against ownership before forwarding — product updates, and every `orderLineId` in a fulfilment (§8.5).
8. **`enabled` and `approvalStatus` are stripped** from vendor input (§8.4).
9. **Owner count invariant** — refuse to revoke or demote the last active Owner of a merchant.

Points 5–8 have no equivalent anywhere else in the stack. With channel-per-vendor Vendure would have enforced them; here, a missed filter on one endpoint is a cross-vendor or vendor-to-merchant catalogue leak. **Enumerate the endpoints and test each one**, rather than trusting that a shared helper is always called.

Multi-marketplace membership raises the stakes on checks 1, 2 and 5. A user belonging to two marketplaces is a live bridge between two tenants, holding one session and one Vendure token that are valid in both. Test the crossings explicitly: a user who is staff in A and a vendor in B must not see A's catalogue while acting in B, must not carry A's capabilities into B, and must not resolve B's `seller_id` while acting in A.

Rate-limit invite and forgot-password endpoints. `requestAdministratorPasswordReset` is non-enumerable in its *response*, but an unthrottled endpoint is still an email-bombing tool.

---

## 10. Build order

1. **Template roles + `__role-templates` channel** (§5.1), with the empty-channel assertion.
2. **Clone-at-provisioning** for merchant channels (§5.2); role ids stored on the tenant record.
3. **BFF session layer** (§4) — login, logout, session store, header injection, §3 invariants.
4. **BFF authorization module** (§9) — before any privileged operation exists.
5. **`AdminInvitePlugin`** (§6.1) — `channelAdministrators` first, then invite/accept.
6. **Portal screens** — user list, invite, accept-invite, forgot/reset password.
7. **Backend hygiene** (§6.4).
8. **`BffGuardPlugin`** (§8.2) — **before the first vendor exists, not after.** Until it ships, any vendor account is a direct-login hole into the merchant's catalogue.
9. **Vendor catalogue** (§8.1, §8.3, §8.4) — custom fields, seller CRUD, filtered reads, sanitised writes, approval setting.
10. **Vendor orders** (§8.5) — only for the tiers actually sold.

Steps 1–4 are foundational in the same sense as SAAS-PLAN §13 steps 1–3. Step 8 is not optional and not deferrable.

---

## 11. Open questions

- **How does a user land in the right marketplace?** With several memberships, does the portal always ask, or remember the last one? Remembering is friendlier and is a client-side convenience only — the server still validates every request (§3.2).
- **Can someone be a vendor *and* merchant staff in the same marketplace?** The membership row allows only one `seller_id` per `(user, channel)`, so today the answer is no. That is probably right, but it should be a deliberate constraint rather than an accident of the schema.
- **Does a vendor see which other marketplaces a product of theirs is in?** They may sell the same catalogue into several. Products are per-channel records, so nothing leaks by default — but a "sell this in my other marketplace" feature would need its own design.
- **Does editing an approved product send it back to `pending`?** (§8.4) Safer, but it lets a vendor pull a live product off the storefront by editing it.
- **What may a vendor see of a customer?** (§8.5) Name and address are needed to ship; email and phone probably are not.
- **What happens to a removed vendor's products?** (§8.6)
- **Refunds and returns spanning sellers** — undesigned (§8.5), and the point at which channel-per-vendor may deserve reconsideration.
- **Is `sessionCacheTTL` lowered, or does the BFF own revocation?** (§2.11)
- **2FA — Owner only, or everyone?** Nothing in core provides it; a BFF-layer concern on the §4 session.
- **Subscription lapse** — SAAS-PLAN §10 blocks writes on `past_due`. Does that block login outright, and what happens to that merchant's vendors?
