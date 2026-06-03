import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets, countRedactions } from '../src/mcp-server/tools/strategies/secret-redactor.js';

describe('Secret Redaction Engine', () => {
  it('redacts OpenAI API keys', () => {
    const input = 'API_KEY=sk-proj-abc123def456ghi789jkl012mno345pqr678';
    const result = redactSecrets(input);
    assert.ok(!result.includes('sk-proj-'), 'OpenAI key should be redacted');
    assert.ok(result.includes('[REDACTED:'), 'Should contain redaction marker');
  });

  it('redacts GitHub tokens (classic PAT)', () => {
    const input = 'token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh';
    const result = redactSecrets(input);
    assert.ok(!result.includes('ghp_'), 'GitHub PAT should be redacted');
    assert.ok(result.includes('[REDACTED:GITHUB_TOKEN]'));
  });

  it('redacts GitHub fine-grained tokens', () => {
    const input = 'GITHUB_TOKEN=github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmno';
    const result = redactSecrets(input);
    assert.ok(!result.includes('github_pat_'), 'Fine-grained PAT should be redacted');
  });

  it('redacts AWS access keys', () => {
    const input = 'aws_access_key_id = AKIAIOSFODNN7EXAMPLE';
    const result = redactSecrets(input);
    assert.ok(!result.includes('AKIAIOSFODNN7EXAMPLE'), 'AWS key should be redacted');
    assert.ok(result.includes('[REDACTED:AWS_KEY]'));
  });

  it('redacts Bearer tokens', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const result = redactSecrets(input);
    assert.ok(!result.includes('eyJhbGciOi'), 'Bearer token should be redacted');
    assert.ok(result.includes('[REDACTED:BEARER_TOKEN]'));
  });

  it('redacts password= patterns', () => {
    const input = 'DB_HOST=localhost\npassword=super_secret_password_123\nDB_PORT=5432';
    const result = redactSecrets(input);
    assert.ok(!result.includes('super_secret_password_123'), 'Password should be redacted');
    assert.ok(result.includes('DB_HOST=localhost'), 'Non-secret lines preserved');
    assert.ok(result.includes('DB_PORT=5432'), 'Non-secret lines preserved');
  });

  it('redacts Stripe keys', () => {
    const input = 'STRIPE_KEY=' + 'sk_test_' + 'fake1234567890abcdefghij';
    const result = redactSecrets(input);
    assert.ok(!result.includes('sk_test_'), 'Stripe key should be redacted');
    assert.ok(result.includes('[REDACTED:STRIPE_KEY]'));
  });

  it('redacts connection strings', () => {
    const input = 'DATABASE_URL=postgres://admin:s3cret@db.example.com:5432/mydb';
    const result = redactSecrets(input);
    assert.ok(!result.includes('admin:s3cret'), 'Connection string should be redacted');
  });

  it('preserves non-secret content that partially matches', () => {
    const input = 'The skeleton key was found in the skill-building module';
    const result = redactSecrets(input);
    assert.equal(result, input, 'Non-secret content should be unchanged');
  });

  it('handles multiple secrets in same output', () => {
    const input = [
      'OPENAI_KEY=sk-proj-abc123def456ghi789jkl012mno345pqr678',
      'GITHUB_TOKEN=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh',
      'password=hunter2_extended_password',
    ].join('\n');
    const result = redactSecrets(input);
    const count = countRedactions(input);
    assert.ok(count >= 3, `Should find at least 3 secrets, found ${count}`);
    assert.ok(!result.includes('sk-proj-'));
    assert.ok(!result.includes('ghp_'));
  });

  it('returns unchanged text when no secrets found', () => {
    const input = 'Hello world\nThis is normal output\n42 tests passed';
    const result = redactSecrets(input);
    assert.equal(result, input);
  });

  it('handles empty and null input gracefully', () => {
    assert.equal(redactSecrets(''), '');
    assert.equal(redactSecrets(null), null);
    assert.equal(redactSecrets(undefined), undefined);
    assert.equal(countRedactions(''), 0);
    assert.equal(countRedactions(null), 0);
  });

  it('redacts Slack tokens', () => {
    const input = 'SLACK_BOT_TOKEN=' + 'xoxb-0000000000-' + 'dummytoken1234';
    const result = redactSecrets(input);
    assert.ok(!result.includes('xoxb-'), 'Slack token should be redacted');
    assert.ok(result.includes('[REDACTED:SLACK_TOKEN]'));
  });

  it('redacts npm tokens', () => {
    const input = '//registry.npmjs.org/:_authToken=npm_abcdefghijklmnopqrstuvwxyz1234567890';
    const result = redactSecrets(input);
    assert.ok(!result.includes('npm_abcdef'), 'npm token should be redacted');
    assert.ok(result.includes('[REDACTED:NPM_TOKEN]'));
  });

  it('redacts private keys in PEM format', () => {
    const input = '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBg...\n-----END PRIVATE KEY-----';
    const result = redactSecrets(input);
    assert.ok(!result.includes('MIIEvgIBADANBg'), 'Private key should be redacted');
    assert.ok(result.includes('[REDACTED:PRIVATE_KEY]'));
  });
});
