// A provider's error may echo a credential back: a token, a signed URL, an Authorization header.
// Whatever text the Admin API shows from one passes through here first (decided on #43).

const redacted = '[redacted]'

const patterns: readonly [RegExp, string][] = [
  // Credentials inside a URL, and the query parameters that sign or authorise one.
  [/(\/\/)[^/\s:@]+:[^/\s@]+@/g, `$1${redacted}@`],
  [/([?&](?:access_token|token|sig|signature|x-amz-signature|x-amz-credential|x-amz-security-token|api_key|apikey|key|secret|password|code|client_secret)=)[^&\s"'<>]+/gi, `$1${redacted}`],
  // Authorization headers, scheme and all, and named secrets, keeping the name so the message reads.
  [/\b(authorization["']?\s*[:=]\s*["']?)(?:(?:bearer|basic|token)\s+)?[^\s"',;}]+/gi, `$1${redacted}`],
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${redacted}`],
  [/\b([\w-]*(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key))(["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi, `$1$2${redacted}`],
  // Well-known token shapes, wherever they stand.
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, redacted],
  [/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}\b/g, redacted],
  [/\bAKIA[0-9A-Z]{16}\b/g, redacted],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, redacted],
  // Any other long opaque string of letters and digits. Ids and digests, all hex and hyphens
  // (a UUID, a commit, a sha256), are kept: staff need them to follow a failure.
  [/\b(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)(?![0-9a-fA-F-]+\b)[A-Za-z0-9_-]{32,}\b/g, redacted],
]

export const redactSecretsInText = (text: string | null): string | null => (text === null ? null : patterns.reduce((out, [pattern, to]) => out.replace(pattern, to), text))
