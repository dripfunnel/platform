# DESIGN.md: code

How modules are written, so the codebase reads as one. Read with
[ARCHITECTURE.md](ARCHITECTURE.md), which says where each piece lives.

Last updated: 2026-09-29.

---

## 1. Module boundaries

- **One public entry per module.** A folder such as `engine/modules/promotions/` exposes what
  others may use through its `index.ts`. Everything else in it is private and may change
  freely. Never deep-import another module's files.
- **Small surface.** Export what callers need, not everything that exists.
- **Named exports only.** No default exports.
- **No side effects on import.** Importing a module never connects, reads the environment,
  registers globals or starts timers.
- **Types come from schemas.** Public functions have explicit parameter and return types.
  Inputs that cross a trust boundary have a zod schema, and the type comes from the schema.

## 2. Configuration and composition

- **Explicit options objects**, validated with zod when created, with defaults stated in
  the schema. No hidden global configuration.
- **Dependency injection over singletons.** Services receive their collaborators (database,
  clock, logger, event bus) through `createEngine(...)`, so tests and tenants never share
  hidden state.
- **Extensibility through registered operations and strategies**, as established headless
  engines do it (PLATFORM-PROMPT §5.10): an integration exports a definition (`defineShippingCalculator`,
  `definePaymentHandler`, `definePromotionCondition`) that the engine registers. Typed args,
  UI hints for the portal, and validation live in the definition.
- **Pure where possible.** Pricing, tax, promotion and money logic are pure functions of their
  inputs, so they can be tested exhaustively and reused in previews and simulations.

## 3. Errors

- **Typed errors with stable codes** from `apps/api/src/core`: `DfError` with a `code`
  (`STORE_NOT_FOUND`, `COUPON_EXPIRED`, `PLAN_LIMIT_REACHED`…), safe `message`, optional
  `details` and `cause`.
- **Expected outcomes are values, unexpected ones are thrown.** An expired coupon is a result
  the caller handles; a lost database connection is an exception.
- **Nothing internal leaks.** Error messages that reach a client never contain SQL, stack
  traces, secrets, other tenants' identifiers or whether an account exists.
- **GraphQL errors** map codes to typed result unions for expected outcomes (error-result
  union types) and to a generic error with a code for unexpected ones. The SPAs
  and `storefront-core` handle them by code, never by message.

## 4. Data and multi-tenancy conventions

- Every function that touches tenant data takes a `TenantContext`. There is no ambient
  "current store".
- Money is always `Money` (minor units + currency). Never a bare number, never a float.
- Timestamps are stored and passed in UTC; conversion to a zone happens only for display, with
  the zone named.
- Identifiers are opaque strings; never parse meaning out of an id.
- Lists are always paginated, with a maximum page size.
- Cache keys include the store (and seller, language, currency where relevant). A cache key
  without a tenant is a bug.

## 5. `apps/ui/shared/ui` (every SPA)

- **Tokens first**: colour, type, spacing, radius, elevation and motion as CSS variables.
  Partners override the brand-level tokens in `apps/ui/store` (CONSOLE-DESIGN §3 fact 17); the
  components never hard-code a colour.
- **Accessible by default**: WCAG 2.2 AA, keyboard and screen-reader support built into every
  component, focus visible, reduced motion respected.
- **Composition over configuration**: small components that compose (`Field`, `Label`,
  `Input`, `Hint`, `Error`) rather than one component with forty props.
- **Every component has its states**: empty, loading (skeleton), error, disabled with a reason,
  read-only. The first platform's portal's `?state=` approach, which makes every designed state
  reachable without a backend, is a shared helper.
- **Words are props, never baked in**: every string comes from the app's messages, so the
  portal can be translated and rebranded.
- `../../../.design/settings-tabs.html` is the visual baseline (PLATFORM-PROMPT §6).

## 6. `storefront-core`

Its design is specified in `../storefront/ARCHITECTURE.md` §2–3 and
`../storefront/DESIGN.md`: hooks, headless components and required components, a theme
contract, no styling of its own beyond required components' class slots. Every export is a
commitment under semver (ARCHITECTURE §5).

## 7. Documentation

- Each app and `storefront-core` has a `README.md`: what it's for, how to run it, and links
  to the relevant doc sections.
- A doc comment only when the name and types don't already say it (AGENTS.md on comments).

## 8. Quality bar for a change

- Types, lint and tests pass (`pnpm turbo run build typecheck lint test`).
- New behaviour has tests; tenant-touching behaviour has isolation tests.
- A change to the API's schema regenerates `apps/api/schema/*.graphql` in the same change.
- A change to `storefront-core` has a changeset stating the bump and why.
- No new dependency without a reason in the pull request, and never one that duplicates an
  existing dependency's job.
