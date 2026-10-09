# PREVIEW.md: the store's preview link

How a store's draft design is put on a link the merchant can open on any device: where its
files come from, where they are kept, how the link is served and protected. Each step says why it
works that way.

[ARCHITECTURE.md](ARCHITECTURE.md) §4.1 says what the preview is: a client-rendered SPA of the
draft theme, with live catalogue data, `noindex`, a signed link and test-mode checkout. This
document owns how it is hosted. [AI-STUDIO.md](AI-STUDIO.md) produces the files, and
[LIVE-SHOP.md](LIVE-SHOP.md) runs the same edge Worker for live sites.

**Status: specification only.** Nothing below is built.

Last updated: 2026-10-09 (decided with Gaurav: previews on `{key}.webpreview.store`, built by the
studio's fast gate, served from R2 by the edge Worker).

---

## 1. Decisions

Decided 2026-10-09 with Gaurav unless the row says otherwise.

| Decision | Rejected | Why |
|---|---|---|
| **Every preview is on one generic domain we own: `{key}.webpreview.store`** | `{shop}.preview.<partnerdomain>` (decided 2026-10-05 on #337, replaced); `{shop}.preview.dripfunnel.com`; a direct R2 link | On our own zone, one wildcard DNS record and Cloudflare's free certificate cover every store, so nothing is set up or paid per store. A partner-domain preview is one more Cloudflare for SaaS hostname per store ($0.10 a month), and wildcard custom hostnames need Enterprise. A separate domain, not a subdomain of `dripfunnel.com`, means the AI's code can never set cookies where the consoles live. The price: preview links show our generic domain, not the partner's. |
| **No direct R2 link** | The bucket's `r2.dev` address; signed R2 URLs | A direct link would put every store on one origin, 404 on any deep link (a SPA needs `index.html` for every path), check no access, and have no `/shop-api` for the cart and checkout. Cloudflare also rate-limits `r2.dev` and says it isn't for production. A signed R2 URL covers one file, so the SPA's own scripts couldn't load. |
| **The studio's fast gate builds the preview; there is no separate preview build** | A preview build per change in a build pool or Actions | The bundle the fast gate already produced is the preview ([AI-STUDIO.md](AI-STUDIO.md) §4), so a preview costs nothing extra and is ready in seconds. What the studio shows is exactly what the link shows. |
| **Served from R2 by the same edge Worker as live sites** | A branch deployment of the store's Pages project (open question in ARCHITECTURE §12, now closed) | Pages per store is gone ([LIVE-SHOP.md](LIVE-SHOP.md) §1), and one serving path for preview and live is less to build and run. |
| **Each store's preview is its own origin**, named by an opaque key | One host with a path per store | The browser keeps origins apart, so one store's AI-written code can't read another store's preview storage or cookies. This is the run-time wall behind the validator's ban (ARCHITECTURE §3.3). |
| **A signed link, `noindex` and test-mode checkout** (decided 2026-10-05 on #284) | An open preview | Unchanged: a draft is private and must never be indexed or take real money. |

---

## 2. The domain (set up once)

1. **Register `webpreview.store`** (available on 2026-10-09, as the `.store` registry reported)
   and add it to Cloudflare as **its own zone**, apart from `dripfunnel.com` (#287).
   *Why:* a separate registrable domain keeps preview cookies and scripts away from the
   consoles.
2. **Add one proxied wildcard DNS record**, `*.webpreview.store`. Cloudflare's free Universal SSL
   certificate covers `*.webpreview.store`.
   *Why:* a new store's preview works the moment it exists, with no DNS or certificate step.
3. **Add one Worker route**, `*.webpreview.store/*` → the edge Worker.
4. **Submit `webpreview.store` to the Public Suffix List** *(proposed)*, as `github.io`,
   `pages.dev` and `r2.dev` are.
   *Why:* browsers then treat each `{key}.webpreview.store` as a separate site, so one store's
   preview can't even set a cookie for another's. Acceptance takes weeks and then ships with
   browser updates; until then the `__Host-` cookie (§5) and the validator's cookie ban
   (ARCHITECTURE §3.4) cover the gap.
5. **The label `{key}` is an opaque preview key per store**: `storefront.preview_key`, 10
   lowercase base32 characters made by the database with the store, unique across the platform
   (decided 2026-10-09; built on #518).
   *Why:* a store's `code` is unique only within its partner (DATA-MODEL §2), and a name would
   let anyone check whether a merchant uses DripFunnel ("never reveal whether an account
   exists").

---

## 3. What is kept in R2

| Path | Holds | Why |
|---|---|---|
| `storefront-sites`: `stores/{id}/preview/{change id}/` | One folder per accepted change: `index.html` and the theme's own chunks | A folder per change makes undo and "back to the previous draft" a pointer move. |
| `storefront-assets`: `core/{version}/` | React, core and the allowed libraries for each core version, built once per release | Shared by every store, so a store's preview upload is only its theme, about 100–300 KB. |
| `design_draft.preview_deploy_ref` (Postgres, DATA-MODEL §7) | Which change folder the preview link shows | The pointer is state the studio shows, kept beside the draft it belongs to. |

- Preview folders are deleted once a publish has made the draft live, except the current one
  *(decide retention on #317)*.
- The theme's chunks stay behind the edge Worker, never on the public asset host.
  *Why:* a draft's code and words are private until published.

---

## 4. Making a preview

**After each accepted studio change** ([AI-STUDIO.md](AI-STUDIO.md) §4):

1. The change passes the fast gate in the store's container, and the gate's bundle is the
   preview.
2. The store's `StudioSession` Durable Object reads the bundle's files out of the container and
   writes them to `stores/{id}/preview/{change id}/`.
   *Why:* the container has no credential and no network (ARCHITECTURE §6.1); the Durable Object
   makes every outside call.
3. The Durable Object moves `design_draft.preview_deploy_ref` to the new folder.
4. The next request to the preview link gets the new version, about 1–2 seconds after the gate
   (our estimate). **The preview's lookup is never cached** (§5 step 4).
   *Why:* the Cache API is per data centre, so a cached pointer could show an old draft for a
   while elsewhere. Preview traffic is only the merchant's team, so asking the API every time
   costs nothing that matters.

**For a brand-new store:** each template's preview bundle is built once per core version, when
the template ships with a core release (ARCHITECTURE §2.3). Creating the store's repo copies that
bundle into the store's first preview folder, a server-side R2 copy (SAAS §5 step 7).
*Why:* the preview opens seconds after the merchant picks a template, without starting a
container.

**Other moments:**
- **Undo** is a new change (a revert), so it gets a new preview by the same steps.
- **Publish** leaves the preview as it is: the draft and the live site are now the same.
- **A core upgrade** reaches the preview the next time the studio opens, because the container
  starts from the new version's image.

---

## 5. Opening a preview

1. **The merchant presses "Open preview"** in the portal. The Store API checks the session and
   the store (ACCESS §3) and signs a link: `https://{key}.webpreview.store/__open?t=<token>`.
   The token names the store and the user, is signed with a Worker secret, and expires
   *(decide the lifetime: 7 days proposed)*.
   *Why:* only the portal can hand out a preview, and every link runs out.
2. **The edge Worker checks the token**: its signature, its expiry, and that **the token's store
   is the store the hostname's preview key resolves to**. Any mismatch gets the same "This
   preview link has expired" page as an expired link. On a match, and after the same access re-check as step 4, it
   sets a `__Host-df_preview` cookie (HttpOnly, Secure, SameSite=Lax, signed, naming the store and
   the user) and redirects to `/` without the token.
   **Lifetimes:**
   - the **cookie is a 15-minute sliding session** *(proposed)*, renewed by every HTML or
     `/shop-api` request that passes the re-check (step 4);
   - the **link is only the way in**: valid for its own lifetime *(decide on #317, 7 days
     proposed)*, and opening it again starts a new session as long as its issuer still has
     access and the store hasn't ended its links.
   *Why:* the preview key is opaque but not secret (it is in every shared link), so a valid
   link for store A must never open store B's draft. The token doesn't stay in
   browser history or leak in a Referer, and the `__Host-` prefix ties the cookie to this one
   subdomain.
3. **Every later request needs the cookie, naming this host's store.** Without it, or once the
   session has run out (a tab left idle for over 15 minutes), the Worker answers with a plain
   page that shows no store data: "This preview has closed. Open it again from your link or from
   the portal." `/shop-api` answers the SPA with an error that makes it show the same screen.
4. **Which check runs on which request:**
   - **HTML and `/shop-api/*` requests get the full re-check.** The Worker asks the API for the
     store's current preview folder (no cached lookup, unlike live sites: LIVE-SHOP §5 step 1),
     and the same call re-checks access:
     - the user the cookie names must still have an active membership of the store with the right
       to see its storefront (ACCESS §5);
     - the cookie's revocation number must equal the store's current one
       (`storefront.preview_epoch` *(proposed, #317)*, which "End all preview links" or a team
       member's removal moves on).

     On a pass, the Worker **renews the 15-minute session cookie**. Otherwise it serves the page
     of step 3.
   - **Chunks need a valid cookie only** (signature, expiry, this host's store), with no API call.
     The Worker **checks the cookie first and only then** looks in its cache, under the store,
     the change folder and the path. The copy it stores carries `Cache-Control: max-age=31536000,
     immutable`, which the Cache API keeps. The response it sends carries `Cache-Control: private,
     max-age=31536000, immutable`, so no shared cache serves it to a request without the cookie.
     Whether the Cache API keeps responses marked `private` is to verify on #317; the stored copy
     never depends on it.

   *Why:* a removed team member or vendor, a user whose capability was taken away, or "End all
   preview links" loses the HTML and `/shop-api` at once. Because the session lives 15 minutes and
   is renewed only by a passing re-check, revocation reaches the chunks within 15 minutes too, with
   no API call per chunk. A theme's chunks are useless without its HTML.

   The Worker then serves `index.html` for any HTML path that isn't a file (the SPA fallback),
   with:
   - `Cache-Control: no-store` on HTML;
   - `X-Robots-Tag: noindex, nofollow`, and a `robots.txt` that disallows everything;
   - the same CSP as live sites.

   *Why:* a fresh change shows on the next load, a draft never reaches a search engine, and the
   browser's walls are the same as on the live site.
5. **`/shop-api/*` goes to the API Worker only after the full re-check of step 4** (the preview
   key isn't secret, so the key alone opens nothing: no test-mode cart or checkout either). The
   API Worker finds the store from the preview key in the hostname
   ([../ARCHITECTURE.md](../ARCHITECTURE.md) §8). The SPA reads products, prices and stock live.
   *Why:* catalogue changes show in the preview at once, with no build.
6. **Checkout runs in each provider's test mode** (decided 2026-10-05 on #284). Whether express
   wallets (Apple Pay, Google Pay) can show on `*.webpreview.store`, given their domain
   registration, is open *(decide on #313)*.

---

## 6. Isolation and security

- **One origin per store**, plus the Public Suffix List entry once accepted (§2 step 4).
- **The store comes only from the hostname's key**, looked up by the Worker. A path or a
  parameter can't name another store, and a link, cookie or studio token for one store is
  refused on another store's host (§5 steps 2–3; an isolation test on #317).
- **Nothing on a preview host answers without the cookie**:
  - HTML and `/shop-api` get the full access re-check on every request;
  - chunks get the cookie, which only a passing re-check renews, every 15 minutes;
  - the studio's `/__studio/` frame and WebSocket use a studio token instead, under the same
    re-check (AI-STUDIO §3 step 6, §8).

  Each has an isolation test on #317 (§5 steps 3–5).
- **A draft is private**: its files sit behind the cookie check, never on the public asset host.
- **No secret reaches the browser** beyond the session cookie. The SPA uses only the public
  store key (ARCHITECTURE §5).
- **The sealed "Preview" banner** sits in the browser's top layer, so a theme can't hide it
  (ARCHITECTURE §3.5).

---

## 7. Cost

Preview traffic is small: the merchant and their team. It costs one Worker request per page
($0.30 per million), R2 storage of a few hundred KB per change, and the domain's yearly fee.
There is no per-store hostname fee.

---

## 8. Open questions

- The Public Suffix List submission for `webpreview.store` *(proposed)*.
- The preview link's lifetime *(decide on #317)*. ~~Whether the merchant can revoke shared
  links.~~ Yes: access is re-checked on every page, and the store's revocation number ends every
  link at once (§5 step 4).
- **Whether a preview link may be passed to someone outside the store's team** *(ask)*. Until
  decided, a link works for whoever holds it, only while the user who issued it still has access
  and the store hasn't ended its links. Binding the link to the viewer's own portal session would
  stop forwarding entirely.
- ~~The `storefront.preview_key` column and its format.~~ 10 lowercase base32 characters, made
  with the store (decided 2026-10-09, §2 step 5).
- ~~Previews on dev and locally.~~ The preview domain is a Worker variable per environment,
  `PREVIEW_DOMAIN`, validated at boot: `webpreview.store` in prod, a second cheap domain
  registered on #287 for dev (for example `webpreview-dev.store`), and `preview.localhost`
  locally (decided 2026-10-09).
- ~~Whether the consoles show a store's preview address.~~ They don't: a preview opens only
  through the merchant's signed link (decided 2026-10-09, #518).
- Express wallets in preview *(decide on #313)*.
- How long old preview folders are kept *(decide on #317)*.
