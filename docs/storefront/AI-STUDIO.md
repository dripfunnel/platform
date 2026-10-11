# AI-STUDIO.md: the AI live studio

How the studio runs when a merchant designs their store with the AI: the container behind each
open studio, where the draft code lives, how a change reaches the live frame, and how a publish
hands the draft to the live site. Each step says why it works that way.

[ARCHITECTURE.md](ARCHITECTURE.md) owns what a change may contain and how it is checked: the
walls (§3), the model's context, the fast gate and what the AI refuses (§6.2).
`../api/SAAS.md` §9.2 owns the studio's API, history and metering, and the prototype
(`designs/PortalStorefront`) owns the screens. This document owns the **infrastructure**.
[PREVIEW.md](PREVIEW.md) and [LIVE-SHOP.md](LIVE-SHOP.md) take the draft from here.

**Status:** built on #482: the sandbox (`apps/sandbox`: §4 steps 3–4, the fast gate, the draft as a git bundle), its
image per core version, the `StudioSession` Durable Object (§3 steps 2–5, §4 steps 1–8, §5 undo, §7), and the frame
on the preview origin with its hot reload (§3 step 6, §4 step 5, §8). The studio's API and screens are #318 and #319.

Last updated: 2026-10-11 (#482: the sandbox, its size and its image).
Before: 2026-10-09 (decided with Gaurav: drafts in private R2 until their publish is live, the live frame
built from the fast gate's bundle, the frame on the store's preview origin).

---

## 1. Decisions

| Decision | Rejected | Why |
|---|---|---|
| **One container per store with a studio open, held by one Durable Object per store** (`StudioSession`) that runs one change at a time (decided 2026-10-08 on #470) | A container per AI request; one shared machine | A change takes seconds because the container is already warm. Merchants never share a machine or a file system, and two tabs on one store can't race. |
| **The container has no network and no credential** (decided 2026-10-08 on #470) | A sandbox that fetches its own files or calls the model | Instructions hidden in a pasted image or a sample site have nowhere to go. The Worker and the Durable Object make every outside call. |
| **The draft is a git bundle in a private R2 bucket; GitHub gets it only once its publish is live** (decided 2026-10-09 with Gaurav; "at Publish" moved after the switch on #520) | A commit to the store's repo per change (decided 2026-10-08 on #470, replaced) | Store repos are public ([LIVE-SHOP.md](LIVE-SHOP.md) §1). A git bundle is the repo and its history in one file, so undo, history and "publish everything before this change" still work on commits. The public repo gets only one squashed commit per published version, with a platform-written message (§6 step 4). |
| **The live frame shows the fast gate's own client bundle, with hot reload** (decided 2026-10-09 with Gaurav) | The Next.js dev server in the container | The gate already builds the bundle, so the frame updates in under a second with no second build. It is byte-for-byte what the preview link shows. The container stays small (about 1 GiB) and starts faster. |
| **The frame runs on the store's preview origin, `{key}.webpreview.store`, not on the portal host** (decided 2026-10-09 with Gaurav) | The frame served through the Store API on the portal host (ARCHITECTURE §6.1 as written on 2026-10-08) | AI-written code must never run on the portal's origin, where the merchant's session lives. The preview origin belongs to this store alone ([PREVIEW.md](PREVIEW.md) §1). |
| **One image per core version, used for the studio and for builds** (decided 2026-10-09 with Gaurav) | Separate studio and build images | A theme that passes in the studio builds the same at Publish. The release workflow publishes it publicly on `ghcr.io` for builds and pushes it to Cloudflare's registry for containers (`../code/ARCHITECTURE.md` §5). |

---

## 2. The pieces

```
 Merchant's browser                                Cloudflare
 ┌────────────────────────────────┐   /api   ┌──────────────────────────────────────────────┐
 │ Studio (apps/ui/store, portal  │ ───────► │ API Worker: Store API, model call            │
 │ host): chat, history, buttons  │          │   └─► Durable Object StudioSession:{store}   │
 │ ┌────────────────────────────┐ │          │         │ one change at a time              │
 │ │ frame: {key}.webpreview.   │ │ ───────► │ edge Worker ──► same Durable Object         │
 │ │ store/__studio (theme SPA) │ │ WebSocket│         ▼                                    │
 │ └────────────────────────────┘ │          │   container (apps/sandbox, the store's       │
 └────────────────────────────────┘          │   core version): no network, no credential   │
                                             │         │                                    │
                                             │   R2 drafts (private): drafts/{store}.bundle │
                                             │   R2 storefront-sites: preview folders       │
                                             └──────────────────────────────────────────────┘
 GitHub: the store's public repo ◄── the draft is pushed only once its publish is live
```

| Piece | Role | Why |
|---|---|---|
| **Studio** (portal SPA) | Chat, history, undo, Publish, and the frame | It talks only to the Store API, under the merchant's own session. |
| **Store API** | Checks the session, the store and the capability (ACCESS §3), calls the model | The partner's or merchant's AI key never leaves the Worker. |
| **`StudioSession` Durable Object** (one per store) | Owns the container, the change in progress and the draft's head commit | One owner per store makes two tabs safe and gives the container one place that talks to it. |
| **Container** | Applies diffs, runs the fast gate, holds the working copy | Workers can't run a typecheck or a bundler; a container can, in isolation. |
| **Private drafts bucket** *(proposed name `storefront-drafts`)* | `drafts/{store}.bundle`, the unpublished code | A container can stop at any moment; the draft must survive it. |
| **Edge Worker on `*.webpreview.store`** | Serves the frame from the container while a session is open | It keeps the frame on the store's own origin. |

---

## 3. Opening the studio

1. **The merchant opens Storefront › Design.** The Store API builds the `TenantContext` from the
   session and checks it (a Manager may only view; SAAS §9.2).
2. **The Store API sends the request to the `StudioSession` Durable Object named by the
   context's store**, never by a store id from the client.
   *Why:* no address or parameter can reach another store's draft (isolation test on #482).
3. **The Durable Object starts the store's container** from the image for the store's core
   version (`storefront.core_version`) *(decide the size: `basic`, ¼ vCPU and 1 GiB, if the
   typecheck fits, else `standard-1`)*.
4. **The Durable Object loads the code into the container:**
   - from **`drafts/{store}.bundle`** when the store has unpublished changes (a `design_draft`
     row exists);
   - otherwise from the **live build's source bundle** (LIVE-SHOP §4 step 3), the published code.

   *Why the Durable Object and not the container:* the container has no network. *Why never
   GitHub:* it doesn't have the unpublished changes, its `main` can lag behind a publish whose push
   is still retrying, and reading R2 doesn't use GitHub's API limits.
5. **The container builds the first bundle** with the fast gate's bundle step.
6. **The frame opens** at `https://{key}.webpreview.store/__studio/{session}/`. `{session}` is
   an unguessable studio-session id (128 random bits) that the Store API creates for this store's
   session. **Every frame request carries it in its path**, so no cookie is needed in the
   cross-site iframe (browsers don't send a SameSite=Lax cookie there, and many block third-party
   cookies):
   - the HTML and the theme's chunks, by relative URL;
   - `/__studio/{session}/shop-api/*`, through core's client base path;
   - the hot-reload WebSocket.

   The edge Worker checks that the hostname's store is the session's store (else nothing is
   served) and asks the store's Durable Object whether the session is live. The Durable Object
   then serves the bundle from the container. Responses carry `Referrer-Policy: no-referrer`,
   and the id is never logged. Until the container is ready, the frame shows the current preview
   ([PREVIEW.md](PREVIEW.md) §3) under "Opening your studio…", served under the same path.
   *Why:* the frame is never blank, a cold start is a few seconds, and the frame works in every
   browser without third-party cookies.

---

## 4. One change

1. **The merchant asks** in words, with a pasted image, or with a sample site's address
   (`askDesign`, SAAS §9.2). The Durable Object runs one change at a time per store; a second
   request waits and shows "Finishing your previous change…".
2. **The Worker calls the model** with the context of ARCHITECTURE §6.2. The model answers
   with a **file diff**.
   *Why:* the diff is data until the gates accept it. The model can't run anything.
3. **The container applies the diff and runs the fast gate** (ARCHITECTURE §6.2): the
   allowlist, the validator, the typecheck, the bundle, the byte budgets and the content
   checks. On failure the model repairs from the exact errors, at most three times; after that,
   "I couldn't make that change" and nothing changes.
4. **On a pass, the container commits the change locally**, with the request as the message.
   These per-change commits, and their messages, stay in the private draft for ever: they never
   reach the public repo (§6 step 4).
   *Why:* every change is a commit, so undo and bisecting work as before.
5. **The frame hot-reloads.** The Durable Object tells the frame, over a WebSocket through the
   edge Worker, that a new bundle is ready. Core's preview adapter swaps in the new theme modules
   and keeps the page, the scroll position and the screen width. This takes under a second
   *(core's adapter needs a hot-swap entry point; on #482 and #304)*.
6. **The Durable Object saves the draft**: it writes the repo as a git bundle to
   `drafts/{store}.bundle` in private R2 and moves `design_draft.head_commit` (DATA-MODEL §7).
   *Why:* a container can stop or crash at any time, but a saved change is never lost.
7. **The Durable Object updates the preview** ([PREVIEW.md](PREVIEW.md) §4), so "Open preview"
   shows the change on any device.
8. **The change is recorded**: a `design_message` with what changed, and an `ai_run` with the
   tokens, container time and repairs (SAAS §9.2).

---

## 5. Undo, discard and going back

- **Undo this change** reverts the latest commit in the container. That is a new change, so §4
  steps 3–8 run again.
- **Discard** resets the draft to the live version's commit (the live build's source bundle,
  never GitHub's `main`), deletes the
  draft bundle and the `design_draft` row, and points the preview at the live code.
- **Go back to version N** first makes that version's build live again by moving the pointer
  ([LIVE-SHOP.md](LIVE-SHOP.md) §4 step 10), then resets the draft to that version's commit
  (ARCHITECTURE §6.2, including its security-release exception).

---

## 6. Publishing from the studio

1. **The merchant presses Publish.** The Durable Object finishes any change in progress first.
2. **If the live commit moved since the draft started** (the upgrade bot's commits touch only
   `package.json` and codemods, never the theme), the container rebases the draft onto it first
   and runs the fast gate again.
3. **The live pipeline builds the draft from private storage** ([LIVE-SHOP.md](LIVE-SHOP.md) §4):
   the Durable Object hands the platform the draft's head commit as a git bundle, which the
   workflow fetches through a 15-minute link. Nothing is pushed yet.
4. **Once the new build is live**, the published tree is pushed to the repo's `main` as **one
   squashed commit with a platform-written message** ("Publish version 12", with the build id)
   through the GitHub App (LIVE-SHOP §4 step 9). No merchant text, no per-change commit and no
   undone version ever reaches the repo; that history stays in the private draft. The draft and `main` are then the same,
   and the next change starts a new draft. A publish that fails its checks, or is refused or
   bisected, pushes nothing: the draft stays private, and the merchant repairs it in the studio.
   *Why:* the design becomes public only when it is live (decided 2026-10-09 with Gaurav,
   #520). One push per publish stays far below GitHub's limit of 6 pushes a minute per
   repo.

   **The push API** (`saas/storefronts/push.ts`, built on #316): the caller names the reason
   (`publish` with the version and build id, `template`, or the upgrade bot's `upgrade`) and the
   platform writes the message from it, so no caller's text reaches the repo. A publish or a
   template change sends the whole theme and replaces it: the files on ARCHITECTURE §3.4's
   allowlist, the only paths accepted (anything else under `src/theme` is the template's and stays), and the upgrade bot may write anywhere but `.github/**`. The commit's parent is
   `storefront.repo_head`, and `main` moves only as a fast-forward from it, so a push finding
   `main` elsewhere is refused (`MAIN_MOVED`) and nothing changes. Each push has the caller's key
   (`storefront_push`): a retry returns the first push's commit, and one retried after a crash
   rebuilds the identical commit (the same tree, parent and date) and finds it on `main` or in its
   history, so a push never lands twice. Commits are authored as `DripFunnel <noreply@dripfunnel.com>`.

---

## 7. Idle, crashes and capacity

- **Idle stop:** a container stops after 10 idle minutes *(proposed; 5 would halve idle cost, at
  the price of more "Opening your studio…" waits)*. The next request starts a new one from the
  draft bundle in a few seconds.
- **A crash mid-change:** the Durable Object starts a new container from the last saved draft
  and retries the change once. The draft is only ever the last saved state.
- **Two tabs or devices** share the store's one container and see the same draft.
- **Capacity** (Cloudflare's account limits, checked 2026-10-09): 6 TiB of memory and 1,500 vCPU
  running at once. That is about **1,500 open studios at `standard-1`, or 6,000 at `basic`**;
  the limits can be raised through Cloudflare. When the limit is reached, studios wait in a
  queue that shows the merchant's place. Whether a plan caps simultaneous studios is open.
- **Cost** (list prices): a container bills memory and disk while it runs, and CPU only while
  working:

  | Size | Per open studio, per hour | 50 studios open 10 hours a day |
  |---|---|---|
  | `standard-1` (½ vCPU, 4 GiB) | about $0.04 | about $600 a month |
  | `basic` (¼ vCPU, 1 GiB) | about $0.01 | about $150 a month |

  Container time is recorded per request in `ai_run.sandbox_ms`, and it is the platform's cost.
- **Image storage:** an account holds at most 50 GB of container images, and stores pinned to
  older core versions still need theirs. At about 1.5–2 GB an image, that is roughly 25–30
  versions at once, so old versions need a retirement rule *(decide on #485)*.

---

## 8. Isolation and security

- **One container, one Durable Object, one draft and one preview origin per store.** Nothing is
  shared between merchants.
- **The container reaches nothing.** It gets files and returns files and reports. The model
  call, GitHub and R2 are the Worker's and the Durable Object's.
- **AI-written code runs only on the store's preview origin**, never on the portal host
  (decision above). The studio and the frame talk by `postMessage`, and each checks the other's
  origin.
- **The studio-session id** (§3 step 6) is a bearer credential in the frame's path, so it is
  held to these rules:
  - **Bound** to one store, one user and the portal session that opened the studio. It is
    accepted only on that store's host.
  - **Checked on every request** under `/__studio/{session}/` (HTML, chunks, `/shop-api`, the
    WebSocket): the edge Worker asks the store's Durable Object whether the session is live
    before anything is read. Studio traffic is one merchant's, so the call per request costs
    little.
  - **Short-lived:** live for **5 minutes** *(proposed)* unless the studio renews it through the
    Store API, which re-checks the user's membership and capability each time (as PREVIEW §5
    step 4 does). Signing out of the portal ends it at once. A user removed or stripped of the
    capability gets no renewal, so the frame stops and the WebSocket closes within 5 minutes.
  - **Never cached under its own value:** chunks may come from the Worker's cache only after
    that check, under the store, the change folder and the path, never the id.
  - **Kept out of logs:**
    - the edge Worker writes the path as `/__studio/:session/…` in its own logs;
    - Workers' automatic invocation logs are off for the edge Worker;
    - the request logs for the `webpreview.store` zone leave out the request path and query
      (LOGGING §9);
    - `Referrer-Policy: no-referrer` keeps it out of Referer headers.
  - **Visible to the theme's code**, which runs on the same origin and could read the address.
    That is accepted, because two walls stand together:
    - the validator refuses reading or assigning `location`, `import.meta`, `document.currentScript`
      and every browser global, and core's router and chunk loader never hand the theme the id
      (ARCHITECTURE §3.4);
    - the **studio frame has its own stricter CSP**: its own origin only for scripts, connections
      and fonts, images only from it and the platform's own media host, and no analytics or
      payment hosts at all (ARCHITECTURE §3.5).

    So even code that saw the id couldn't send it off the platform. A stolen id is worth at most
    the 5 minutes before the next renewal, for the draft of a store whose team member was already
    in the studio.
- **Drafts never go public before they are live.** A failed or refused publish pushes nothing
  (§6 step 4). They sit in the private drafts bucket, under
  `drafts/{store}.bundle`, which only the Durable Object reads and writes. The same bucket holds
  each build's source under `sources/`, which only the platform writes and hands out as 15-minute
  links to that build's own run (LIVE-SHOP §2).
- **A sample site** is fetched as a screenshot by the platform, public addresses only, never by
  the container (ARCHITECTURE §6.2; [../ARCHITECTURE.md](../ARCHITECTURE.md) §7).

---

## 9. Open questions

- ~~The container size.~~ **`basic`** (¼ vCPU, 1 GiB, 4 GB disk; decided on #482). The fast gate over the
  baseline theme (22 files) peaked at **365 MiB** in the sandbox's process, the first change in 1.0 s and later
  ones in 0.33 s on a developer's laptop (2026-10-11); expect about four times that on ¼ vCPU. The Durable
  Object starts it as custom resources (`vcpu: 0.25, memoryMib: 1024, diskMb: 4096`), since the
  `durable_object` scheduling policy, which picks the image per start, takes no `basic` name and has no
  `max_instances`. A theme near the 200-file cap is to measure on dev.
- **How the sandbox works** (decided on #482):
  - the model's diff is a list of **whole files**, each with its new text or `null` to remove it, not a
    patch: the validator judges whole files, and a patch that doesn't apply is one failure fewer;
  - the change is judged before anything is written: the validator runs over the theme in memory, then
    the files are written, then the typecheck, the bundle and the byte budgets; any failure puts the
    working copy back with `git reset --hard` and `git clean`;
  - the typecheck resolves `react`, core's `./theme` and the allowlisted libraries from the image, never
    from the store's repo, and leaves a `t('file.key')` argument to the validator, because core's
    `Translate` names only core's own keys;
  - the **byte budgets** (ARCHITECTURE §9) count the theme's own chunks and CSS, the part a change can move.
    Core's runtime (react, react-dom, core and the boot module; motion only when a theme imports it) is
    about 172 KB gzipped on its own, so the whole page's weight is the publish gate's to judge;
  - the bundle's page loads one module by an absolute `/assets/` path and has no inline script; the
    theme's chunks import core's runtime by relative path from `assets/core/`, which the container serves
    from its image and a preview's host maps to `core/{version}/` (PREVIEW §3);
  - every commit is authored by `DripFunnel <noreply@dripfunnel.com>`, and git runs with no config of
    its own, no hooks and the `file` protocol only;
  - the server refuses to start when a variable that looks like a credential is set, and blocks
    `fetch`, sockets, HTTP and DNS inside its own process on top of the container's `enableInternet: false`.
- ~~The idle timeout.~~ **10 minutes** (decided on #482): a merchant reading the preview between asks often passes 5,
  a container at `basic` costs about a cent an hour, and a cold start reloads the saved draft in seconds.
- **How the Durable Object runs a change** (decided on #482):
  - `StudioSession` is named by the store id of the session's `TenantContext` (`studioOf`), keeps that id in its
    storage on the first call, and refuses a call for any other store;
  - one change at a time: a promise chain per object, with `pending` for "Finishing your previous change…";
  - the model is the Worker's: the Store API passes it to `change()` over RPC, so the partner's or merchant's
    key never reaches the object's storage or the container; a repair asks it again with the gate's
    problems (`ai_run` rows of kind `repair`, billed to `platform`, under the request's own run);
  - it loads `drafts/{store}.bundle`, else the live build's `sources/{store}/{build}.bundle`, else, for a store
    that has never published, the template's files from the sites bucket (the template's commit on GitHub
    is never read);
  - each accepted change saves, in this order: the draft bundle, the preview folder
    `stores/{id}/preview/{change id}/` (each file with its SHA-256), `design_draft.head_commit` and
    `preview_deploy_ref` with `storefront.custom_paths`, then the frame's reload notice;
  - a sandbox that stops answering is started again from the saved draft and the step is tried once more;
    a second failure answers "unavailable" and the draft stays at its last saved state;
  - a load that fails after the container started stops it and gives its place back; a change the model or
    the sandbox fails partway is metered as `failed`, with every ask already made;
  - only opening, changing and undoing keep a studio from its idle stop; the alarm stops a container whose object
    was evicted (no runner left to reach it), and one whose lapsed lease the ledger won't renew;
  - the validator's languages are the store's languages' base codes (`en-IN` → `content/en/`), which core's
    i18n reads for every region of a language; content and post paths are empty until SAPI 24 adds them;
  - **capacity**: the `durable_object` scheduling policy has no `max_instances`, so one `StudioCapacity` object
    keeps a ledger of `STUDIO_CAPACITY` running studios (default 5,000, short of the ~6,000 the account's
    vCPU allows at `basic`): a running studio's lease is renewed every minute and lapses 3 minutes after the
    last renewal; a waiting studio keeps its place by when it first asked and leaves the queue a minute
    after it stops asking.
- Whether a plan caps simultaneous studio sessions *(decide on #287; #482 caps only the account, by `STUDIO_CAPACITY`)*.
- ~~The studio session's renewal interval.~~ **Live 5 minutes, renewed every 2** (decided on #482), so one missed
  renewal never closes the frame. The id is 128 random bits (22 base64url characters) kept only as its SHA-256 in
  `studio_session`, which references the portal session: signing out deletes it. A renewal re-checks the caller as
  the Store API resolved them on that request; a seat that lost the studio deletes the session at once. The Owner
  changes, a Manager views, and staff, suppliers and support sessions get no studio (ACCESS §5.1 `publish`). A studio session
  is live only while its portal session is fully signed in: `stage = 'full'`, inside both its absolute and idle bounds.
- ~~The WebSocket path through the edge Worker.~~ **`/__studio/{session}/__hot`** (decided on #482), on the frame's own
  origin, so the studio CSP's `connect-src 'self'` covers it. How the frame is served (decided on #482):
  - store-proxy sends `{key}.<PREVIEW_DOMAIN>/__studio/*` to the API's `StorefrontEdge`; the router gives `/__studio`
    an area on that entry only, so a portal host or the public entry answers 404;
  - the API finds the store from the host's preview key, and forwards to that store's Durable Object with the store
    id in a header it sets itself; `/__studio/{session}/shop-api` goes to the preview host's Shop API after the
    object's `check`, with the id taken out of the path (so out of the Shop API's cache key);
  - the object checks the session against its own store before anything is read, then serves the container's file,
    `index.html` for any other page path, with the bundle's `/assets/` references moved under the session's prefix;
  - HTML is `no-store`, chunks `private, max-age=31536000, immutable`, every response `Referrer-Policy: no-referrer`
    and `X-Robots-Tag: noindex, nofollow`; the page carries core's `studioCsp`, built in the sandbox from the
    frame's own origin (images reach it through `/shop-api/assets/`) and the partner's live portal host;
  - until the container answers, the frame is an empty page that reloads every 2 seconds, and the portal shows
    "Opening your studio…" over it (#319): serving the preview's files would need the preview's headers, which
    are #317's;
  - the hot-reload socket is tagged with the session's hash; the object's alarm closes a socket within a minute
    of its session ending (signed out, expired, or a seat that lost the studio);
  - the session id reaches no log: the API's request line holds the host, the status and the timing only, and
    store-proxy's own request line writes the path as `/__studio/:session/…` (LOGGING §9).
- ~~Core's hot-swap entry point.~~ **`connectHotReload`** in `platform/render/studio` (decided on #482): the frame's
  boot reads `/__studio/{session}/` from core's own module address (`studioBasePath`), points the Shop API client at
  `/__studio/{session}/shop-api` (`studioShopEndpoint`), and on each notice imports the new entry and renders its
  pages into the same root, applying only the newest bundle and putting the scroll back.
- The retirement rule for old core versions' images *(decide on #485)*.
