# ui/merchant-mobile-app: one codebase, one build and one developer account per partner

How the merchant mobile app reaches the App Store and Google Play under each partner's brand,
and why every partner publishes from its own developer account. The framework decision is in
[REACT-NATIVE.md](REACT-NATIVE.md).

**Status: decided, not built.** Store guideline text checked on 2026-10-08 (§3); check it
again before the first submission.

Last updated: 2026-10-08.

---

## 1. Decisions

| Decision | Rejected | Why |
|---|---|---|
| **One codebase, one build per partner** (decided 2026-10-08) | One app in the stores for every partner, with a domain picker on first launch | Each partner's app carries its own name, icon and listing, so white label holds in the stores too (SAAS.md §3.3). A shared picker app would be listed, named and iconed as DripFunnel. |
| **Builds, store submissions and listings are manual, from per-partner configuration** (decided 2026-10-08, §2) | Building and submitting on every merge to `dev` or `main` | Every submission goes through Apple's and Google's review and reaches merchants' phones, so a person decides when each partner's app ships. Keeping everything that differs per partner in configuration keeps each manual run small and repeatable. |
| **One developer account per partner**, owned by the partner and operated by DripFunnel (decided 2026-10-08) | Every partner's app published from one DripFunnel account | Apple rejects template apps that the provider submits for its clients (4.2.6), and both stores treat many near-identical apps from one account as spam (§3). One shared account also shows "DripFunnel" as seller on every listing, and one strike can take down every partner's app at once (§4). |
| **The partner owns, pays for and is liable for its store accounts; DripFunnel reaches each one with that partner's own least-privilege credentials** (decided 2026-10-08, §5) | DripFunnel paying the fees; one DripFunnel login across every partner's account | The brand owner is the seller of record, as Apple 4.2.6 and 5.2.1 expect. Separate credentials keep one partner's account problem from reaching another's. |
| **No app for a partner without its own store accounts** (decided 2026-10-08, §5) | A DripFunnel-listed picker app for those partners | White label holds everywhere, and there is no second app, listing and release track to maintain. Those merchants keep the web portal. |
| **App icon and splash images are uploaded in the partner console's branding screen** (decided 2026-10-08, §5) | Asking each partner for the files outside the platform | They sit with the rest of the partner's look in `partner_branding`, so a build takes them from configuration like everything else. |

---

## 2. How it works

**One codebase.** A single React Native app serves every partner.

**One build per partner.** Two kinds of brand settings:

| Fixed at build time, per partner | Loaded at runtime from the brand query |
|---|---|
| Portal domain (`PARTNER_DOMAIN`) | Colours, font, corner style, dark mode |
| App name under the icon | Logo, mark, sign-in background |
| App icon and splash screen | Wording, "Powered by", support contact |
| Bundle id (iOS) and package name (Android) | |
| Store listing: screenshots, description | |
| Push notification credentials, deep-link domain | |

The phone and the app stores read the build-time settings before any of our code runs. The runtime
settings come from the same `partner_branding` the web portal reads (SAAS.md §3.3), so a rebrand
reaches the app without a new release.

**Per-partner configuration.** Everything in the left column lives in that partner's
configuration entry, never in code, so adding a partner is configuration, not code. The entry
takes what it can from `partner_branding`. Signing credentials and store keys are kept in EAS's
credential store per partner, never in the repo (AGENTS.md "Security").

**Builds, submissions and listings are manual** (§1):

- Merging a pull request to `dev` or `main` runs the app's gates (typecheck, lint, test) like any
  other app. It never builds, submits or publishes the app.
- A person starts each partner's build and submission by hand, from that partner's profile.
- The store listing (name, description, screenshots, privacy and data-safety answers) is entered
  by hand in App Store Connect and Play Console, from the text and images kept in the partner's
  configuration.
- Over-the-air updates (EAS Update, REACT-NATIVE.md §3) are published by hand too.

**One developer account per partner.**

1. The partner enrols as an **organization** with the Apple Developer Program ($99 a year) and
   Google Play Console ($25 once). Both need the partner's legal entity and a D-U-N-S number.
2. The partner gives DripFunnel access: Apple through a team role or an App Store Connect API
   key, Google through a Play Console user invitation or a service account.
3. DripFunnel builds, signs and submits the partner's app from the shared codebase, by hand
   (§2).
4. The listing, reviews and ratings belong to the partner and stay with them if they leave.

---

## 3. What the store guidelines say

### Apple App Store ([App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/))

- **4.2.6:** "Apps created from a commercialized template or app generation service will be
  rejected unless they are submitted directly by the provider of the app's content. These
  services should not submit apps on behalf of their clients…" The other accepted option is "a
  single binary to host all client content in an aggregated or 'picker' model."
  → DripFunnel is the template provider; each partner is the content provider and must submit
  from its own account.
- **4.3(a) Spam:** "Don't create multiple Bundle IDs of the same app." A separate app per
  partner under one account is exactly this.
- **4.3(b):** "Repeated submissions of this kind may lead to removal from the Apple Developer
  Program." The risk reaches the whole account, not just one app.
- **5.2.1 Intellectual property:** "Apps should be submitted by the person or legal entity that
  owns or has licensed the intellectual property," and nothing misleading may appear "in your
  app bundle or developer name." The partner owns its brand, so the partner submits.

### Google Play ([Developer Program Policy](https://support.google.com/googleplay/android-developer/answer/9899034))

- **Spam, repetitive content:** a listed violation is "creating multiple apps with highly
  similar functionality, content, and user experience," and Google suggests one app that
  aggregates the content instead. Per-partner apps from one account match this description.
- **Impersonation** ([policy](https://support.google.com/googleplay/android-developer/answer/9888374)):
  "Don't imply that your app is related to or authorized by someone that it isn't." Publishing
  a partner's brand under DripFunnel's name needs the partner's rights for every app.
- **Enforcement** ([enforcement process](https://support.google.com/googleplay/android-developer/answer/9899234)):
  when an account is terminated, every app in its catalogue is removed, and related developer
  accounts are terminated too.

---

## 4. The risk of one DripFunnel account for every partner

| Risk | What happens | How likely |
|---|---|---|
| **Rejection** | Apple rejects the second or third partner app under 4.2.6 or 4.3(a); Google flags it as repetitive content. | High: these rules are written for this case. |
| **Losing every app at once** | One strike, appeal lost or repeat violation, and the account is closed: every partner's app is removed from the store together. On Google, related accounts go with it. | Low per app, but the damage covers every partner. |
| **White label broken** | The listing shows "DripFunnel" as seller or developer on every partner's app. Merchants see it as soon as they search the store. | Certain. |
| **Brand and legal exposure** | DripFunnel publishes trademarks it doesn't own and has to prove the rights for each partner (Apple 5.2.1, Google impersonation). DripFunnel also carries the partner's privacy and data-safety statements as its own. | Certain, for every partner. |
| **No clean exit** | When a partner leaves, its app, reviews and users sit in DripFunnel's account. Moving an app to another account is possible but slow, and the partner depends on us to do it. | Certain, for every partner that leaves. |

**With one account per partner:** each app is submitted by the brand owner, the listing shows
the partner's name, a problem with one partner's app stays in that partner's account, and a
partner that leaves keeps its app.

**What it costs us:**
- a one-time store setup for each new partner (enrolment, D-U-N-S, giving DripFunnel access,
  icons and listing text);
- each partner's signing credentials and store keys held in EAS's credential store;
- slower onboarding, since Apple's organization enrolment can take days to weeks.

---

## 5. Partner accounts: setup and responsibility (decided 2026-10-08)

- **App icon and splash.** `partner_branding` stores the logo and mark (SAAS.md §3.3) but no
  app-icon or splash images. The partner console's branding screen gets an upload for them,
  stored with `partner_branding`. That is a new field and likely a migration, built on its own
  card.
- **The access DripFunnel asks for** is the least that lets it build, sign and submit: the
  smallest Apple role or App Store Connect API key scope, and the smallest Play Console
  permissions. What each partner granted is recorded in
  [code/THIRD-PARTY-ACCESS.md](../../code/THIRD-PARTY-ACCESS.md).
- **Each partner's account is reached through its own credentials**: that partner's API key or
  service account, never one DripFunnel login shared across partners. Google doesn't publish
  how it decides accounts are related, so separate credentials keep one partner's problem away
  from the others (§3).
- **A partner without its own Apple or Google account gets no app** until it enrols. Its
  merchants use the web portal. There is no DripFunnel-listed picker app.
- **The partner owns, pays for and is liable for its store accounts.** It holds the Apple and
  Google accounts, pays their fees, is the seller of record, and answers for the listing's
  privacy and data-safety statements. The partner agreement says so.
