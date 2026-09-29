# admin

The admin console for DripFunnel staff (DF Admin): a static SPA on Cloudflare Pages at
`admin.dripfunnel.com`, calling the Admin API at `/api`. It manages every partner and platform.
Guide: [docs/ui/admin/](../../../docs/ui/admin/README.md); design: [CONSOLE-DESIGN.md](../../../docs/ui/admin/CONSOLE-DESIGN.md).

```bash
pnpm --filter ./apps/ui/admin dev   # http://localhost:5175, /api proxied to the local Worker
```

## Screen states

The state kit lives in `src/features/common/`: `EmptyState`, `LoadingState`, `ErrorState`,
`PermissionDenied`, `ReadOnlyNotice` and `ConfirmDialog`. Every word comes in as a prop from
`src/messages/`.

Any screen can be forced into one state without an API by adding `?state=` to its address
(`empty`, `loading`, `error`, `denied`, `readonly`, `confirm`). The screen calls
`useScreenState([...])` with the states it offers and lists them in its header comment; an
unknown or unoffered value is ignored.

`/states` shows every state and the dialog in one place.

The harness (both `?state=` and `/states`) is on under `vite dev`, and in a build only when
`VITE_STATE_HARNESS=1` is set at build time. Production never sets it, so there `?state=` is
ignored and `/states` shows the router's "Not Found" page (Pages still answers 200, as it
does for every SPA path).
