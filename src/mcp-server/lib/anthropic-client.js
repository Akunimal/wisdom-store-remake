/**
 * Anthropic SDK client factory with OAuth-first auth resolution.
 *
 * Mike's preference: bill against his Pro/Max subscription via OAuth, never
 * silently fall back to API key (which would charge his API budget). Tools
 * must opt in explicitly via `allowApiKey: true` to use ANTHROPIC_API_KEY.
 *
 * Investigation result (claude-loop136, 2026-05-09): in this MCP subprocess,
 * NO `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` env var is exported
 * (only `AI_AGENT`, `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_EXECPATH`).
 * So the SDK won't auto-resolve OAuth — we read `~/.claude/.credentials.json`
 * directly and pass the access token via the SDK's `authToken` option (which
 * sends `Authorization: Bearer <token>`). Claude Code OAuth additionally
 * requires the `anthropic-beta: oauth-2025-04-20` header.
 *
 * Credential file shape (700-perms, OAuth bearer + refresh):
 *   {
 *     claudeAiOauth: {
 *       accessToken: string,    // 108-char bearer token
 *       refreshToken: string,
 *       expiresAt: number,      // ms epoch
 *       scopes: string[],
 *       subscriptionType: string,
 *       rateLimitTier: string
 *     }
 *   }
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import Anthropic from '@anthropic-ai/sdk';

const CREDENTIALS_PATH = path.join(os.homedir(), '.claude', '.credentials.json');
const OAUTH_BETA_HEADER = 'oauth-2025-04-20';

function readOauthCredentials() {
  try {
    const raw = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
    const data = JSON.parse(raw);
    return data?.claudeAiOauth || null;
  } catch {
    return null;
  }
}

/**
 * Get an authenticated Anthropic SDK client.
 *
 * @param {object} opts
 * @param {boolean} [opts.allowApiKey=false] — if true, fall back to ANTHROPIC_API_KEY
 *   when OAuth is unavailable. This bills the API budget instead of the subscription,
 *   so it must be explicit.
 * @returns {{ client: Anthropic, authMode: 'oauth'|'apiKey', billing: 'subscription'|'api', subscriptionType?: string }}
 * @throws {Error} with `code` when no auth path resolves cleanly.
 */
export function getAnthropicClient({ allowApiKey = false } = {}) {
  const oauth = readOauthCredentials();

  if (oauth?.accessToken) {
    if (oauth.expiresAt && Date.now() >= oauth.expiresAt) {
      const expiredAt = new Date(oauth.expiresAt).toISOString();
      const err = new Error(
        `OAuth access token expired at ${expiredAt}. ` +
        `Re-authenticate via Claude Code (run /login or restart). ` +
        (allowApiKey
          ? `Falling back to ANTHROPIC_API_KEY since allowApiKey:true.`
          : `Set allowApiKey:true to use ANTHROPIC_API_KEY (your billing).`)
      );
      err.code = 'OAUTH_EXPIRED';
      if (!allowApiKey) throw err;
      // Otherwise fall through to API key path below.
    } else {
      const client = new Anthropic({
        authToken: oauth.accessToken,
        defaultHeaders: { 'anthropic-beta': OAUTH_BETA_HEADER }
      });
      return {
        client,
        authMode: 'oauth',
        billing: 'subscription',
        subscriptionType: oauth.subscriptionType
      };
    }
  }

  if (allowApiKey) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      const err = new Error(
        `No OAuth credentials at ${CREDENTIALS_PATH} and ANTHROPIC_API_KEY is unset. ` +
        `Either log in via Claude Code (recommended — uses your subscription) or set ANTHROPIC_API_KEY.`
      );
      err.code = 'NO_AUTH';
      throw err;
    }
    return {
      client: new Anthropic({ apiKey }),
      authMode: 'apiKey',
      billing: 'api'
    };
  }

  const err = new Error(
    `No OAuth credentials at ${CREDENTIALS_PATH}. ` +
    `Re-authenticate via Claude Code, OR pass allowApiKey:true to bill against ANTHROPIC_API_KEY.`
  );
  err.code = 'OAUTH_MISSING';
  throw err;
}

/**
 * Anthropic API token-pricing snapshot (USD / million tokens). Used for cost
 * line generation. Subscription billing doesn't see these prices, but Mike
 * wants visibility-by-default, so we report the equivalent API cost.
 *
 * Update when pricing changes. Last updated 2026-05-09.
 */
export const PRICING = {
  'claude-sonnet-4-6': { in: 3.00, out: 15.00 },
  'claude-haiku-4-5-20251001': { in: 0.80, out: 4.00 }
};

export function formatCost(model, inputTokens, outputTokens) {
  const p = PRICING[model];
  if (!p) return `${inputTokens} in / ${outputTokens} out (model ${model} not in price table)`;
  const inCost = (inputTokens / 1_000_000) * p.in;
  const outCost = (outputTokens / 1_000_000) * p.out;
  const total = inCost + outCost;
  const inK = (inputTokens / 1000).toFixed(1) + 'k';
  const outK = (outputTokens / 1000).toFixed(1) + 'k';
  return `$${total.toFixed(2)} — ${inK} in / ${outK} out`;
}
