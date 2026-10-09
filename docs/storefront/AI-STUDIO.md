# AI-STUDIO.md: the AI live studio

How the studio runs when a merchant designs their store with the AI: the container behind each
open studio, where the draft code lives, how a change reaches the live frame, and how a publish
hands the draft to the live site. Each step says why it works that way.

[ARCHITECTURE.md](ARCHITECTURE.md) owns what a change may contain and how it is checked: the
walls (§3), the model's context, the fast gate and what the AI refuses (§6.2).
`../api/SAAS.md` §9.2 owns the studio's API, history and metering, and the prototype
(`designs/PortalStorefront`) owns the screens. This document owns the **infrastructure**.
[PREVIEW.md](PREVIEW.md) and [LIVE-SHOP.md](LIVE-SHOP.md) take the draft from here.

**Status: specification only.** Nothing below is built.

Last updated: 2026-10-09 (decided with Gaurav: drafts in private R2 until their publish is live, the live frame
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
                                             │   R2 drafts (private): drafts/{id}.bundle    │
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
6. **The frame opens** at `https://{key}.webpreview.store/__studio/`, carrying a short-lived
   studio token the Store API signed for this session. The edge Worker checks the token, and that
   **its store is the store the hostname's preview key resolves to** (else nothing is served),
   and passes requests to the same Durable Object, which serves the bundle from the container. Until
   the container is ready, the frame shows the current preview ([PREVIEW.md](PREVIEW.md) §3) under
   "Opening your studio…".
   *Why:* the frame is never blank, and a cold start is a few seconds.

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
   *Why:* the design becomes public only when it is live (decided 2026-10-09 with Gaurav, on PR
   #521's review). One push per publish stays far below GitHub's limit of 6 pushes a minute per
   repo.

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
- **The studio token** is short-lived, names one store and one session, must name the store of
  the hostname it arrives on (PREVIEW §5 step 2), and is checked on every
  frame request and on the WebSocket.
- **Drafts never go public before they are live.** A failed or refused publish pushes nothing
  (§6 step 4). They sit in the private drafts bucket, under
  `drafts/{store}.bundle`, which only the Durable Object reads and writes. The same bucket holds
  each build's source under `sources/`, which only the platform writes and hands out as 15-minute
  links to that build's own run (LIVE-SHOP §2).
- **A sample site** is fetched as a screenshot by the platform, public addresses only, never by
  the container (ARCHITECTURE §6.2; [../ARCHITECTURE.md](../ARCHITECTURE.md) §7).

---

## 9. Open questions

- The container size: `basic` if the typecheck and bundle fit in 1 GiB, measured with a real
  theme *(decide on #482)*.
- The idle timeout: 10 minutes proposed, 5 suggested *(decide on #482)*.
- Whether a plan caps simultaneous studio sessions *(decide on #287 and #482)*.
- The studio token's lifetime and the WebSocket path through the edge Worker *(decide on #482)*.
- Core's hot-swap entry point for the preview adapter *(decide on #304 and #482)*.
- The retirement rule for old core versions' images *(decide on #485)*.
