# AI account OAuth provider review

Last updated: 2026-10-28

This records provider requirements checked against official documentation on 2026-10-28.
It does not grant approval or change the runtime behavior. The current implementation is
described in [THIRD-PARTY-ACCESS.md §2.6](THIRD-PARTY-ACCESS.md).

## Anthropic: Claude subscription OAuth

Anthropic's [Claude Code legal and compliance documentation](https://code.claude.com/docs/en/legal-and-compliance)
distinguishes subscription OAuth from developer API access. It says OAuth is intended for
ordinary use of Claude Code and native Anthropic applications; developers building products
that interact with Claude should use Claude Console API keys or a supported cloud provider.
It also says Anthropic does not permit third-party developers to offer Claude.ai login in
their apps or route requests through Free, Pro or Max credentials on users' behalf. Offering
Claude Code in a hosted product requires a mutually agreed commercial arrangement; the
documentation also disallows paying for, reselling or intermediating Claude usage for end
users. DripFunnel's requested hosted designer integration therefore requires written
authorization and terms that expressly cover this product and architecture before use.

The requested OmniRoute `claude setup-token` path does not change that conclusion. The
[OmniRoute setup-token guide](https://github.com/cheaper-inference/OmniRoute/wiki/Claude-Code-Setup-Token)
describes collecting a long-lived Claude Code OAuth token (`sk-ant-oat01-…`), checking it
with a one-token Messages request, and storing it for later inference. Its token has the
`user:inference` scope and no refresh token. This is OmniRoute's implementation, not
Anthropic approval for DripFunnel. The documented restriction on third-party collection,
storage, or intermediation of Claude account tokens applies to this import path as well.

**Official contact route:** submit the use case through Anthropic's [Claude API sales
inquiry](https://www.anthropic.com/claude/api) / Speak with Sales form. The legal center
also provides the [official support messenger](https://support.anthropic.com/en/articles/9015913-how-to-get-support)
for an API or Claude account. Ask Sales to route the request to the team that can approve
third-party Claude subscription OAuth and hosted inference. The published documentation
does not identify a special OAuth registration form or guarantee an approval path.

### Authorization request draft

**Subject:** Written authorization and supported OAuth registration for DripFunnel's hosted
multi-tenant storefront designer

DripFunnel operates a multi-tenant commerce platform. Each Partner and Merchant would
connect its own Claude account from its authenticated console. The connected account would
be used only for that owner's explicitly initiated storefront-design requests. Our API runs
on Cloudflare Workers; the designer request is made by our Worker, and the storefront
editing sandbox is isolated from credentials. Credentials would be encrypted at rest,
scoped to their Partner or Merchant owner, excluded from logs, refreshable and removable.
Usage would be attributed to the owner, provider and model. We would not pool credentials,
fall back to another tenant's account, or use a connected account for another owner's
requests.

We understand the current Claude Code legal documentation says Claude subscription OAuth is
for Claude Code and native Anthropic apps, directs third-party developers to API
authentication, and disallows third-party Claude.ai login or routing Free, Pro or Max
credentials for users. We are seeking written authorization **before enabling this use**.

Please confirm whether Anthropic can authorize this specific hosted, user-initiated,
multi-tenant use of Claude Free/Pro/Max subscription credentials, including user-generated
`claude setup-token` credentials; whether a commercial agreement or product/partner
registration is required; whether Anthropic provides a supported OAuth client registration,
redirect/callback requirements, scopes, token refresh/revocation interfaces and inference
endpoint for this use; which subscription tiers are eligible; and any usage, privacy,
retention, security review, branding or end-user disclosure requirements. If Worker-mediated
execution or remote encrypted token storage is not permitted, please identify an approved
architecture, if one exists.

### Technical profile to approve

This is a proposed protocol profile for Anthropic to approve or replace. It deliberately does
not assume a client identifier, redirect URI, scopes, beta headers, or token endpoint. Those
must come from Anthropic's written approval and registration instructions.

| Stage | Proposed behavior | Provider decision needed |
|---|---|---|
| Authorization | Authorization Code with PKCE (`S256`), fresh high-entropy `state`, exact registered redirect URI; bind the attempt to the signed-in Partner or Merchant and initiating user | Whether subscription OAuth can be registered for this app; approved client ID, redirect URI, scopes and consent language |
| Callback | Validate single-use state and callback ownership, exchange code server-side, discard provider error bodies, encrypt returned tokens immediately | Official token endpoint, exchange format, token audience and claims |
| Studio inference | A user-initiated design edit calls the documented Anthropic Messages API using that owner's token, chosen permitted model and bounded output; no Claude Code identity text, synthetic usage metadata, CLI user-agent, or private endpoint | Whether subscription tokens may call Messages API from this hosted Worker; required headers and supported model/feature restrictions |
| Renewal and disconnect | Refresh only under the owning credential row lock; redact errors; revoke remotely if Anthropic offers an approved endpoint, then delete locally | Refresh/revocation contract and token lifetime/rotation rules |
| Metering | Store run usage with the owning Partner or Merchant, provider and model; no cross-owner fallback | Whether/how subscription usage should be reported or credited |

The submitted question is for a supported product integration, not for matching Claude
Code's wire identity. If Anthropic requires Claude Code-specific requests, ask it to identify
an expressly authorized integration path and provide its requirements in writing.

No approval has been obtained. Do not treat this draft, the existing OAuth code, or the
user's own subscription as authorization.

## OpenAI: Sign in with ChatGPT and plan usage

OpenAI's [Sign in with ChatGPT developer quickstart](https://developers.openai.com/siwc/quickstart)
and [client ID request page](https://developers.openai.com/siwc/request-client-id) say
commercial access is limited to selected partners; interested commercial partners should
join via the [interest form](https://openai.com/form/sign-in-with-chatgpt-interest/).
OpenAI documents a separate open-source-client path with dynamic client registration and a
Responses API contract, but that does not describe DripFunnel's hosted commercial Worker.

The [SIWC terms](https://openai.com/policies/sign-in-with-chatgpt-terms/) require the
application's own identity, tokens obtained through its supported flow, and any persistent
token storage to be local and under the user's control, not remote or managed. ChatGPT-plan
requests must originate from the user's local runtime or a remote runtime only that user
controls, must be for that user and their activity, and cannot let another user's activity
trigger use. The terms prohibit pooling, transferring, reselling or sharing tokens/plan
usage and prohibit using one user's subscription for another user's requests. Therefore the
current centralized Worker and remotely stored account tokens do not fit these documented
requirements. SIWC identity-only login is distinct from plan usage; identity OAuth alone
does not provide inference access.

The existing adapter is not a registered DripFunnel client and the gateway's account-token
inference path is not the documented commercial SIWC flow. A legitimate client ID and
redirect registration would be required, but would not by themselves resolve the runtime
and token-storage mismatch. No SIWC approval or registration has been obtained.

## Existing implementation reviewed

- The OAuth storage and attempt records carry explicit `partner` or `store` owners; partner
  credential queries constrain both credential ID and partner ID, while store queries use
  store ID. Tokens are sealed by `SecretBox` and callback state/finish keys are hashed.
- OAuth and API-key authentication are represented separately by `auth_type`.
- The AI gateway already has streaming adapters, usage recording, and credential selection
  that prefers the owning partner or merchant account; the review found distinct OAuth
  adapters using Codex CLI and Claude Code client identifiers in the uncommitted worktree.
- The tracked worktree changes present before this review are preserved. No code, migration,
  test, or existing documentation was changed for this review note.

The existing Claude subscription OAuth implementation and any proposed setup-token import
remain unsupported for DripFunnel unless Anthropic provides written authorization for this
architecture. A user's consent to connect their own account does not replace that provider
authorization. No setup-token import endpoint or credential format is implemented.

## Official references

- [Claude Code Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)
- [Anthropic Claude API / sales](https://www.anthropic.com/claude/api)
- [Anthropic support](https://support.anthropic.com/en/articles/9015913-how-to-get-support)
- [Sign in with ChatGPT quickstart](https://developers.openai.com/siwc/quickstart)
- [Request a Sign in with ChatGPT client ID](https://developers.openai.com/siwc/request-client-id)
- [Sign in with ChatGPT terms](https://openai.com/policies/sign-in-with-chatgpt-terms/)
- [OpenAI's commercial interest form](https://openai.com/form/sign-in-with-chatgpt-interest/)
