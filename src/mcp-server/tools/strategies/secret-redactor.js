/**
 * Secret Redaction Engine
 * Inspired by Token-Saver's secret redaction system.
 *
 * Detects and redacts API keys, tokens, passwords, and other secrets
 * from command output before it reaches the LLM context window.
 *
 * Design principles:
 * - Patterns are ordered from most specific to least specific
 * - Each pattern requires sufficient length to avoid false positives
 * - The redaction marker preserves the type of secret for debugging
 */

/**
 * Secret detection patterns.
 * Each entry: { name, pattern, replacement }
 * The replacement uses the name to indicate what was redacted.
 */
const SECRETS_PATTERNS = [
  // OpenAI API keys (sk-proj-..., sk-...)
  { name: 'OPENAI_KEY', pattern: /\bsk-(?:proj-)?[a-zA-Z0-9]{20,}/g },
  // Anthropic API keys
  { name: 'ANTHROPIC_KEY', pattern: /\bsk-ant-[a-zA-Z0-9\-]{20,}/g },
  // GitHub tokens (classic PAT, fine-grained, OAuth, app)
  { name: 'GITHUB_TOKEN', pattern: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[a-zA-Z0-9_]{20,}/g },
  // AWS Access Keys (always start with AKIA)
  { name: 'AWS_KEY', pattern: /\bAKIA[A-Z0-9]{16}/g },
  // AWS Secret Keys (40 chars, base64-ish)
  { name: 'AWS_SECRET', pattern: /(?<=aws_secret_access_key\s*[=:]\s*)[a-zA-Z0-9/+=]{40}/gi },
  // Google API keys
  { name: 'GOOGLE_KEY', pattern: /\bAIza[a-zA-Z0-9_-]{35}/g },
  // Stripe keys (live/test)
  { name: 'STRIPE_KEY', pattern: /\b(?:sk|pk|rk)_(?:live|test)_[a-zA-Z0-9]{20,}/g },
  // Generic Bearer tokens in headers
  { name: 'BEARER_TOKEN', pattern: /Bearer\s+[a-zA-Z0-9\-._~+/]+=*/gi },
  // Authorization headers with Basic auth (base64)
  { name: 'BASIC_AUTH', pattern: /Basic\s+[a-zA-Z0-9+/]{20,}={0,2}/gi },
  // Private keys (PEM format)
  { name: 'PRIVATE_KEY', pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g },
  // Connection strings (postgres, mysql, mongodb, redis)
  { name: 'CONNECTION_STRING', pattern: /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis(?:s)?):\/\/[^\s'"`,)}\]]+/gi },
  // Generic key=value patterns for common env vars
  { name: 'SECRET_VALUE', pattern: /(?:API_KEY|API_SECRET|SECRET_KEY|ACCESS_TOKEN|AUTH_TOKEN|PRIVATE_KEY|DB_PASSWORD|DATABASE_URL|REDIS_URL)\s*[=:]\s*[^\s'"`,)}\]]{8,}/gi },
  // password= patterns (key=value in URLs, configs, or env files)
  { name: 'PASSWORD', pattern: /(?:password|passwd|pwd)\s*[=:]\s*[^\s'"`,)}\]]{4,}/gi },
  // npm tokens
  { name: 'NPM_TOKEN', pattern: /\bnpm_[a-zA-Z0-9]{36}/g },
  // Slack tokens
  { name: 'SLACK_TOKEN', pattern: /\bxox[bpras]-[a-zA-Z0-9\-]{10,}/g },
  // Discord tokens
  { name: 'DISCORD_TOKEN', pattern: /\b[MN][a-zA-Z0-9]{23,}\.[a-zA-Z0-9_-]{6}\.[a-zA-Z0-9_-]{27,}/g },
];

/**
 * Redact all detected secrets in the given text.
 * Returns the redacted text.
 */
export function redactSecrets(text) {
  if (!text) return text;

  let result = text;
  for (const { name, pattern } of SECRETS_PATTERNS) {
    // Reset regex lastIndex for global patterns
    pattern.lastIndex = 0;
    result = result.replace(pattern, `[REDACTED:${name}]`);
  }
  return result;
}

/**
 * Count how many secrets would be redacted without mutating the text.
 * Returns the count of matches.
 */
export function countRedactions(text) {
  if (!text) return 0;

  let count = 0;
  for (const { pattern } of SECRETS_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = text.match(pattern);
    if (matches) count += matches.length;
  }
  return count;
}

export { SECRETS_PATTERNS };
