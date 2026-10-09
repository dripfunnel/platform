# LIVE-SHOP.md: how a store's live site is built, stored and served

How a store's live storefront gets from its code to a shopper's browser: the store's repo, the
build, where the built files are kept, and the one Worker that serves every store. Each step
says why it works that way.

This document owns the **infrastructure**. [ARCHITECTURE.md](ARCHITECTURE.md) owns what is
built and checked: the theme contract, the walls around AI-written code (§3) and the gate
suite every publish passes (§4.2). [PREVIEW.md](PREVIEW.md) covers the preview link, and
[AI-STUDIO.md](AI-STUDIO.md) covers where the draft lives before it is published.
`../api/SAAS.md` owns the state and rules: provisioning (§5), domains (§8) and publishing
(§9.1).

**Status: specification only.** Nothing below is built.

Last updated: 2026-10-09 (decided with Gaurav: public store repos built by GitHub Actions, the
built files in R2, one edge Worker for every store, the publish checks inside the workflow).

---

## 1. Decisions

Decided 2026-10-09 with Gaurav unless the row says otherwise.

| Decision | Rejected | Why |
|---|---|---|
| **One public GitHub repo per store**, created when the merchant first picks a template | Private repos built in Cloudflare Containers (decided 2026-10-08 on #470, replaced); one repo holding every store | Builds on GitHub-hosted runners cost nothing in public repos. A repo per store keeps its own push limit (GitHub allows 6 pushes a minute per repo), its own history, and makes deleting or exporting a merchant one repo operation. One shared repo would share those 6 pushes between every store, pass GitHub's recommended 3,000 entries per folder and 10 GB, and turn a merchant's deletion request into a rewrite of everyone's history. |
| **The code reaches GitHub only once its publish is live** (decided 2026-10-09; first "at Publish", moved after the switch on PR #521's review) | A commit to the repo for each accepted AI change (decided 2026-10-08 on #470, replaced); pushing at Publish, before the checks | The repos are public. A commit per change would show unreleased products, sale banners and half-finished designs before the merchant publishes them, and a busy studio would push several times a minute. The draft lives in private storage until then ([AI-STUDIO.md](AI-STUDIO.md) §1), and a publish that fails its checks never makes it public. |
| **A locked workflow in each repo builds the site, started only by the platform** (`workflow_dispatch`) | A build on every push; a pool of build containers | The platform decides when a build runs and keeps one build at a time per store (SAAS §9.1). A push alone builds nothing, so nothing outside the platform can start a deploy. |
| **The build runs inside the public build image for the store's core version, with networking off** | `npm install` on the runner; a private image or package with a pull token | It is the same image the studio uses ([AI-STUDIO.md](AI-STUDIO.md) §1), so a theme that passed the studio's fast gate builds the same way. GitHub's npm registry needs a token even for public packages, but a public image on `ghcr.io` needs none. With no network, the AI's code can't call out during the build, and the same inputs always give the same files. |
| **No secret in any repo: GitHub OIDC, and the API mints 15-minute R2 credentials limited to that build's staging folder** | A Cloudflare token in each repo's secrets; one token in an organisation secret | An R2 token can be limited to a bucket, never to a folder, so a token in every repo could overwrite every store's site and its old versions. A GitHub OIDC token lasts minutes and names the repo and the workflow that asked. The credential the API mints can write only the new build's staging folder: not any build folder, not older builds, and not the live pointer. The API copies verified files into the build's folder itself (§4 step 9). |
| **Built files in R2, a folder per store and per build** | A Cloudflare Pages project per store (decided 2026-10-05 on #284, replaced); a Worker per store | Cloudflare allows 100 Pages projects per account and doesn't routinely raise the limit; normal Workers stop at 500 per account. R2 has no such limit. Keeping every build as its own folder makes going back to an earlier version a pointer move, with no rebuild. |
| **One edge Worker serves every store**, choosing the store by hostname | Workers for Platforms with a Worker per store; rendering pages on each request | Every store runs the same serving code, so nothing is deployed per store. The cost is one Worker request per page, $0.30 per million. Rendering on request remains possible later (§11). |
| **Hashed JS, CSS and images come from a shared asset host with no Worker in front** | Every file through the edge Worker | Cloudflare bills a Worker request even when the answer comes from cache. A page loads several files, so serving them past the Worker is the largest saving there is (§10). |
| **Merchant domains stay Cloudflare for SaaS custom hostnames on the zone's catch-all route** (SAAS §8) | A Worker route per hostname | A zone's catch-all route names exactly one Worker, which already sits in front of partner portal hosts. The same Worker tells portal hosts and storefront hosts apart. |

---

## 2. The pieces

```
 GitHub (dripfunnel org)                    Cloudflare
 ┌─────────────────────────────┐           ┌──────────────────────────────────────────────────┐
 │ store repo (public, one per │  OIDC     │ API Worker (apps/api)                            │
 │ store): published code only │ ────────► │   GitHub App · OIDC check · R2 credentials       │
 │ .github/workflows/build.yml │ ◄──────── │   publish-storefront Workflow · Postgres         │
 │ (locked)                    │ dispatch  └──────────────┬───────────────────────────────────┘
 └──────────────┬──────────────┘                          │ live pointer, cache purge
                │ upload (15-min credentials)             ▼
                ▼                            ┌──────────────────────────────────────────────┐
 ┌─────────────────────────────┐             │ edge Worker (store-proxy, extended)          │
 │ R2 storefront-sites         │ ◄────────── │   hostname → store → live build → file       │
 │   stores/{id}/builds/{b}/   │   reads     │   /shop-api/* → API Worker                   │
 │ R2 storefront-assets        │             └──────────────▲───────────────────────────────┘
 │ stores/{id}/builds/{b}/ core/{v}/│ ◄─ asset host (no Worker)  │
 └─────────────────────────────┘                            │ Cloudflare for SaaS
                                                   shopper on www.merchantbrand.com
```

| Piece | What it holds or does | Why it is separate |
|---|---|---|
| **Store repo** | The published theme code, the generated files and the locked workflow (ARCHITECTURE §2.2) | The public, free place to build. It holds only what is already live. |
| **API Worker** | Starts builds, checks OIDC tokens, mints R2 credentials, records `publish_run`, moves the live pointer | Every credential and every decision stays on the platform, never in a repo or a runner. |
| **`storefront-sites` bucket** *(proposed name)* | Each build's HTML and data files, the preview files ([PREVIEW.md](PREVIEW.md) §3), and the short-lived staging folders every upload lands in, its JS and CSS included (§4 step 8) | Never public. The edge Worker reads build and preview folders; the API reads staging folders and writes build folders (§4 step 9); the studio's Durable Object writes preview folders (PREVIEW §4); an upload credential writes one staging folder only. |
| **`storefront-assets` bucket** *(proposed name)* | Each build's content-hashed JS and CSS under its own build folder (`stores/{id}/builds/{b}/assets/`), and each core version's shared runtime (`core/{version}/`, written only by the release workflow) | Public and immutable, so the asset host serves it straight from cache with no Worker. |
| **A private drafts bucket** *(proposed name `storefront-drafts`)* | `drafts/{store}.bundle`, unpublished drafts ([AI-STUDIO.md](AI-STUDIO.md) §3); `sources/{store}/{build id}.bundle`, each build's source (§4 step 3); the snapshots | Source code that isn't public yet must never share a bucket with files that are served. Only the platform touches it: the studio's Durable Object reads and writes `drafts/` and reads `sources/`; the API writes `sources/` and the snapshots and hands a run 15-minute read links to its own build's files; nothing else reads it. |
| **Edge Worker** | Answers every storefront request | One code path for every store; nothing per store to deploy. |
| **Postgres** | `storefront`, `publish_run`, `design_version`: which build is live, and the history (DATA-MODEL §7) | The live pointer is state the consoles show, not a file. |

---

## 3. Creating a store's repo (once per store)

Part of the `create-storefront` Workflow (SAAS §5 steps 4–8), when the merchant first picks a
template.

1. **The GitHub App creates a public repo with an opaque name**, for example
   `dripfunnel/sf-k7f3q9` *(proposed)*.
   *Why:* the org's list of public repos would otherwise list every merchant by name.
2. **It copies `templates/storefront/`** with the chosen template's theme, the generated
   `store.config.ts` and route shims, `package.json` pinning the current core version, and
   the **locked workflow** `.github/workflows/build.yml`.
   *Why:* the store starts as a complete, buildable site. The workflow comes from the template,
   so every store builds the same way.
3. **No secrets and no variables are added.** The repo accepts no outside contributions, and
   the workflow runs only on `workflow_dispatch`.
   *Why:* there is nothing in the repo to steal, and nothing but the platform can start a run.
4. **The AI can never change the workflow.** `.github/**` is outside the file allowlist
   (ARCHITECTURE §3.4), and the GitHub App is the only writer.
   *Why:* a workflow the AI could edit could leak or skip anything.
5. **The first preview** comes from the template's ready-made preview bundle ([PREVIEW.md](PREVIEW.md)
   §4). The first live build is the merchant's first Publish (SAAS §5).

---

## 4. Publishing: from code to live

The same steps run for every kind of publish (SAAS §9.1: design, catalogue, automatic, staff,
core upgrade, security). `publish_run` records each step's real state (queued, building,
checking, deploying, live, failed, rolled back).

1. **A publish starts** and the `publish-storefront` Workflow creates the store's
   `publish_run`, one at a time per store.
   *Why:* two builds racing for one store could put the older one live.
2. **Nothing reaches GitHub yet.** A design publish builds the draft's head commit from the
   store's private draft (AI-STUDIO §6); other publishes build the **live commit**, read from the
   live build's kept source bundle (step 3), never from GitHub. The repo's `main` gets the draft
   only once this publish is live (step 9).
   *Why:* the repo is public. A publish that fails its checks, or is refused or bisected, must
   never make an unreleased design public (decided 2026-10-09 with Gaurav, on PR #521's review).
3. **The platform freezes the input**, as private files for this build behind 15-minute links:
   - the catalogue snapshot, read once from the Shop API (ARCHITECTURE §5);
   - the source to build, as a git bundle of that commit, **kept privately with the build** for as
     long as the build is kept (`sources/{store}/{build id}.bundle` in the private drafts bucket).
     The live build's bundle is the platform's own record of the live code: the studio, Discard,
     the next publish and the upgrade bot read the live commit from it, never from GitHub;
   - the live build's files, for the visual diff.

   *Why:* the run reads only these, so it needs no network and no repo checkout, and two builds
   of the same commit and snapshot give the same files.
4. **The platform starts the workflow** with `workflow_dispatch`, passing a **single-use build
   id**, through the GitHub App.
   *Why:* the build id ties the run to this `publish_run`, so a run can't upload into another
   build, and an old id is refused.
5. **The workflow is one job**, so the built site never leaves the runner as an artifact. Its
   permissions are `id-token: write` and nothing else.
   - **Networking off:** the AI-written code (the static build, and the theme in the headless
     browser) runs only inside a `docker run --network none` container of
     `ghcr.io/dripfunnel/storefront-build:<core version>`, with an allowlisted environment: no
     `GITHUB_TOKEN`, no `ACTIONS_*` variables and no OIDC request URL. Inputs are mounted
     read-only, and one output folder is writable.
   - The runner steps around the container are the locked workflow's own code. They alone use
     the network and OIDC.
   - The job's logs say only which step ran and whether the publish passed; the details go to
     the API.

   **Step `fetch`:** the runner gets its OIDC token and sends it, with the build id, to the API.
   The API checks the token (§9) and answers with the three links of step 3, then the runner
   downloads them.
   *Why:* everything private stays off GitHub (no artifact, nothing readable in public logs),
   and the AI's code can reach neither the network nor a token.
6. **Step `build`:** the container runs the validator over the whole theme (ARCHITECTURE §3.4),
   then the static build (SSG), into its output folder.
7. **Step `check`:** the gate suite of ARCHITECTURE §4.2 step 3 runs **inside the workflow**
   (decided 2026-10-09 with Gaurav), in a fresh container of the same image with the browser and
   gate tools preinstalled. The built files are mounted read-only, and the container serves them
   to its own headless browser and checks them:
   - contract tests per route;
   - sealed-component visibility at 3 widths;
   - axe accessibility checks;
   - the budgets (ARCHITECTURE §9);
   - the no-JS render check and the crawl;
   - the content scan;
   - the edge-case catalogue render;
   - a visual diff against the live build's files from step 3.

   The checkout smoke test runs against core's offline Shop API fixture *(proposed)*; the real
   checkout is the post-deploy check (step 10). The container writes each check's pass or fail
   to its output folder. A runner step then:
   - computes the **digest of the files it handed to the container**: SHA-256 over the sorted
     list of each file's path and SHA-256, computed outside the container;
   - sends the **report** (the results and the digest) **straight to the API** by OIDC.

   *Why:* the checks cost nothing on public repos and need no browser service of ours. The AI's
   code can't reach the runner, the report or the API, and the digest ties the report to exact
   bytes (step 9). A theme that behaves differently under checks is what the validator's ban on
   environment sniffing (ARCHITECTURE §3.4) and the post-deploy checks from the edge (step 10)
   are there to catch.
8. **Step `upload`:**
   - **After a passing report**, the API mints **an R2 temporary credential for the private
     `storefront-sites` bucket only, limited to a staging folder `stores/{id}/uploads/{build id}/`
     and to 15 minutes**. Nothing is ever staged in the public `storefront-assets` bucket. The
     step uploads the HTML and data files, the hashed JS and CSS, and a **manifest** listing every
     file with its SHA-256, then tells the API "uploaded".
   - **On a failure** nothing is uploaded. The API records the report, and the repair, bisect or
     refuse steps of ARCHITECTURE §4.2 step 4 start from it. A repair runs in the studio's
     sandbox (AI-STUDIO), then a new build. The live site stays as it was, and nothing became
     public.

   *Why:* the credential can't touch a build folder, another store or anything already live.
9. **Verify, copy, switch, then push.** The API:
   1. checks that the report came through an OIDC-verified call (§9) and passed, and that the
      manifest's digest equals the report's;
   2. reads each staged object through its R2 binding, checks its SHA-256 against the manifest
      (R2's upload checksums aren't relied on), and copies it into the build's folder, the hashed
      JS and CSS into the public bucket only now that they are verified:
      `stores/{id}/builds/{build id}/` in `storefront-sites`, and
      `stores/{id}/builds/{build id}/assets/` in `storefront-assets`. A file the manifest marks
      unchanged since the live build *(proposed, §10)* is copied server-side from the live build's
      folder instead, after the same SHA-256 check, so **every build folder is complete on its
      own**: the Worker never follows a reference, and clean-up can delete any old build;
   3. deletes the staging folder, moves the live pointer, records the new build as live
      (`publish_run` with the report as its `gate`, `design_version`) and refreshes the edge
      Worker's lookup (§5 step 1);
   4. for a design publish, pushes the draft's commits to the repo's `main` in one push through
      the GitHub App ([AI-STUDIO.md](AI-STUDIO.md) §6). If GitHub is down, the push retries
      through the outbox; the live site doesn't wait for it. The push is always made from the live
      build's source bundle, so a push that lags behind catches up with every commit since
      `main`, fast-forward.

   *Why:* **build folders are write-once by construction**, because no credential ever names
   them, so a kept build stays exactly as it was for going back. The build that goes live is
   provably the build that passed: the same bytes, checked by a run of the locked workflow the
   API started. A switch is atomic in each data centre and everywhere within the lookup's
   60-second limit (§5 step 1). The repo gets the code only once it is live; `main` follows the
   live code, usually within seconds, but the platform never reads it back: the live build's
   source bundle is the record (step 3). Each core version's shared runtime (`core/{version}/`) is written only
   by the release workflow. The post-deploy checks (step 10) are the platform's own backstop.
10. **Post-deploy checks and automatic rollback**, from the edge, run by the platform, follow
    ARCHITECTURE §4.2 steps 5–6. A rollback is the same pointer move back to the previous build:
    no rebuild, live everywhere within a minute (§5 step 1).
11. **Clean-up:** a store keeps its last builds *(decide: 20 proposed)* and every build a kept
    version in the history refers to (SAAS §9.2). Older build folders are deleted, along with
    each build's snapshot and its source bundle (`sources/{store}/{build id}.bundle`). Staging
    folders are deleted at the switch or when a run fails. **Deleting a store** (or a deletion
    request) deletes all its folders in both buckets and everything of its in the drafts bucket:
    the draft, every source bundle and every snapshot (SAAS §5).

---

## 5. Serving a page

What the edge Worker does on each request to a storefront host.

1. **Hostname → store, live build and state**, cached in each data centre through the Cache
   API for **at most 60 seconds**. On a miss, the Worker asks the API Worker (service binding,
   Postgres through Hyperdrive). A publish, a domain change or a state change also sends a purge
   by the store's cache tag, which makes the change show sooner where it reaches. Nothing depends
   on that purge: the Cache API is per data centre, and Cloudflare doesn't promise every purge
   reaches its entries *(to verify on #317)*. So a switch, a rollback or a suspension is atomic
   in each data centre and reaches every data centre **within 60 seconds**.
   *Why:* the store comes **only from the hostname**, never from the path or the client. A KV
   read on every request would cost more than the requests themselves; a cache lookup costs
   nothing extra. A miss happens at most once a minute per store per data centre, roughly once
   per visit at 1,000 visits a day, which the API and Postgres take easily. A strongly consistent
   lookup on every request (a Durable Object) would cost a call per page for a minute's gain.
2. **A past-due or suspended store** gets its degraded page from the Worker, with no rebuild
   (ARCHITECTURE §4.2, DESIGN-BRIEF fact 9).
3. **`/shop-api/*` goes to the API Worker** through a service binding, keeping the shopper's
   own hostname ([../ARCHITECTURE.md](../ARCHITECTURE.md) §2).
   *Why:* same origin, so the shopper's cookies stay first-party and there is no CORS.
4. **Any other path → the file** `stores/{id}/builds/{live build}/{path}` from the edge cache,
   or from R2 on a miss. **The cache key is the store id, the build id and the path**, and build
   ids are random and unique across the platform (the `publish_run` id), so no store's cached page
   can answer for another's (AGENTS.md: cache keys always include the tenant).
   *Why:* when the pointer moves, old cached pages simply stop matching, so a switch is atomic.
5. **The file is passed through untouched**, with headers set from the build: the CSP (built
   from fixed hashes, never a fresh nonce), the cache rules, and the redirects the build
   recorded (renamed products' 301s, ARCHITECTURE §8).
   *Why:* reading or rewriting every page would multiply the Worker's CPU time. Passing the file
   through keeps it at about 1–2 ms a request.
6. **Unknown or removed product addresses** get a client-rendered fallback, a 404 or a
   redirect (ARCHITECTURE §4.2, "Staying current").
7. **JS, CSS and images** load from the shared asset host (`storefront-assets` through its own
   domain, outside the catch-all route; it holds only verified build folders and `core/`) and from Cloudflare image resizing, never through this
   Worker.

---

## 6. Domains

- **Until the merchant connects a domain**, the live site is `{shop}.shops.<partnerdomain>`. The
  partner adds one wildcard DNS record, and each store's address is registered as its own
  Cloudflare for SaaS custom hostname (SAAS §5 step 3, §8).
  *Why:* registering each name works on every Cloudflare plan. A wildcard custom hostname
  would need Enterprise.
- **A merchant's own domain** is another custom hostname on the same zone (SAAS §8). It reaches
  the same edge Worker, which maps it to the same store.
- Each hostname costs about $0.10 a month after the first 100, on every plan below Enterprise
  (checked 2026-10-09).

---

## 7. Updates between publishes

- **A new or renamed product** gets its page at once with a **single-page render** (decided
  2026-10-08 on #470: page, sitemap, redirect, IndexNow, no allowance). Where it runs is open
  *(decide on #484)*:
  - the store's workflow with a one-page input: about a minute, and free;
  - or a small render in a Cloudflare container: seconds, as decided, but billed.
- **Saving the home page's search and sharing** re-renders the home page the same way (SAAS
  §9.2).
- Either way, the new files go into a **new build folder**, the API copies the live build's
  other files into it server-side (§4 step 9), and the pointer moves. Every build folder stays
  complete on its own.
  *Why:* a live build is never changed in place, so it can always be gone back to.

---

## 8. Core upgrades and security fixes

- **The upgrade bot** (ARCHITECTURE §7, SAAS §10) makes the new core version's pin and its
  codemods a commit on top of the live commit, kept privately like a draft. It runs §4 with the
  new build image, and the commit reaches the repo's `main` only once that build is live.
  *Why:* the same pipeline, so an upgrade is checked exactly like a merchant's publish.
- **Waves are limited by Actions concurrency** (§10). A security fix is queued ahead of
  automatic publishes.
- **The baseline-theme fallback** for a store whose theme can't take a security fix
  (ARCHITECTURE §7) is a build of the baseline theme with the store's words and colours. It is
  stored and switched like any other build.

---

## 9. Isolation and security

- **The OIDC check.** The API accepts a token only when every one of these holds:
  - the issuer is GitHub's (`token.actions.githubusercontent.com`) and the audience is ours;
  - `repository_id` is that store's repo;
  - `job_workflow_ref` is the locked workflow on `main`;
  - the event is `workflow_dispatch`;
  - the build id is unexpired, belongs to that store, and is bound to the first `run_id` that
    uses it.

  *Why:* a token from any other repo, workflow, branch or run is worthless.
- **The AI's code holds nothing and reaches nothing.** The static build and the checks run
  inside `--network none` containers with an allowlisted environment (§4 step 5): no secrets,
  no tokens, no network. Only the locked workflow's own runner steps use OIDC, and the upload
  credential exists only after a passing report, for a staging folder, for 15 minutes. Every
  third-party action in the workflow is pinned by commit hash.
  *Why:* the AI-written code and any token or credential are never within reach of each other.
- **The workflow's permissions:** `id-token: write` and nothing else (no `contents: write`).
  There is one job, so there are no artifacts to forge or to read.
- **The report is bound to the bytes**: the check step's digest must equal the manifest's, and
  every staged object must hash to its manifest entry before the API copies it into the build's
  folder and moves the pointer (§4 step 9).
- **The repo is public by design, so nothing private ever reaches it:**
  - no secrets;
  - no catalogue snapshot or built site (the run fetches them through 15-minute links and keeps
    them on the runner; there are no artifacts);
  - no draft until its publish is live (§4 step 2);
  - nothing in the logs but which step ran and whether it passed.
- **Who touches each bucket** (§2 table): the edge Worker only reads `storefront-sites`, building
  every key from the hostname's store, so no request can name another store's folder. The API
  reads staging folders and writes build folders; the studio's Durable Object writes preview
  folders; an upload credential writes one staging folder for 15 minutes. The drafts bucket is
  the platform's alone (§2).
- **The GitHub App is the only writer** to store repos (THIRD-PARTY-ACCESS §2.3), and merchants
  never get repo access (SAAS §10).

---

## 10. Limits and cost

Checked against the providers' pages on 2026-10-09. The estimates are ours, not measurements.

- **GitHub Actions concurrency is shared by every repo in the org**: 20 jobs at once on Free, 60
  on Team, 500 on Enterprise; a job may run 6 hours. One build a day for 5,000 stores is about
  20,000 build-minutes a day, roughly 14 at once on average. The org's plan follows from that
  *(decide on #287)*.
- **GitHub's Actions terms** forbid "excessive use" and serverless use. Thousands of repos
  building on a schedule should be raised with GitHub before it reaches that size, and a
  fallback should exist: the same build image run in Cloudflare Containers *(decide)*.
- **Cloudflare list prices:**
  - Workers: $0.30 per million requests, cache hits included, plus $0.02 per million CPU ms.
  - R2: $0.015 per GB-month; $4.50 per million writes; $0.36 per million reads.
  - Cloudflare for SaaS: $0.10 per hostname per month after 100.
- **What keeps the bill small:**
  - assets off the Worker path (§5 step 7);
  - the hostname lookup in the cache, not KV (§5 step 1);
  - no per-request HTML rewriting (§5 step 5);
  - uploading only the files that changed since the live build: the manifest marks the rest
    unchanged, and the API copies them server-side from the live build's folder into the new one
    (§4 step 9), so every build folder stays complete *(proposed)*.
- **For scale:** our estimate for 5,000 stores with 1,000 visits a day each and one build a day
  each is about **$3,500–5,000 a month all-in**, studio included. About $250 of that is the edge
  Worker.

---

## 11. Open questions

- ~~Where the publish checks run and what switches a store to its new build.~~ Inside the build
  workflow; the API switches on an OIDC-verified passing report (decided 2026-10-09, §4 steps
  7–9).
- Whether the checkout smoke test can run offline against core's Shop API fixture, leaving the
  real checkout to the post-deploy check *(proposed, decide on #483)*.
- The GitHub org's plan for Actions concurrency *(decide on #287)*.
- A fallback build runner if GitHub limits Actions on the org *(decide)*.
- Where single-page renders run: the workflow (about a minute, free) or a container (seconds,
  billed) *(decide on #484)*.
- **Image resizing cost** *(ask)*. Cloudflare image resizing (decided 2026-10-05 on #337) bills
  each unique transformation again every calendar month. For 5,000 stores with 1,000 images in 4
  sizes, that is about 20 million transformations, roughly $10,000 a month at list price.
  Resizing once at upload and storing the sizes in R2 would cost a small fraction of that.
- How many builds a store keeps (20 proposed), and the bucket names *(decide on #317)*; the repo names *(decide on #316)*.
- Rendering pages on request instead of building them all (Workers for Platforms, a Worker per
  store) is a later option for very large catalogues. It isn't planned.
