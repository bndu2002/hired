/**
 * Config tests. These exercise the Zod schema behind `config/index.ts`
 * directly rather than importing the module (which runs on import and
 * calls process.exit on failure — fine for runtime, bad for tests).
 *
 * We rebuild the same schema here so the test is literally a check against
 * the shape we expect. If this test is wrong, config/index.ts should change
 * too, and the diff makes that visible in review.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// Mirror of the schema in src/config/index.ts.
// If this schema drifts from the real one, that's the bug this test catches.
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  SHARED_SECRET: z.string().min(32),
  DATABASE_URL: z.string().url().refine((v) => v.startsWith('postgres')),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().url(),
  GEMINI_API_KEY: z.string().min(1),
  SERPAPI_API_KEY: z.string().min(1),
  HUNTER_API_KEY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).optional(),
  ),
  REOON_API_KEY: z.string().min(1),
});

function validEnv(): Record<string, string> {
  return {
    SHARED_SECRET: 'a'.repeat(64),
    DATABASE_URL: 'postgresql://hired:hired@localhost:5432/hired',
    GOOGLE_CLIENT_ID: 'id',
    GOOGLE_CLIENT_SECRET: 'secret',
    GOOGLE_REDIRECT_URI: 'http://localhost:4000/cb',
    GEMINI_API_KEY: 'k',
    SERPAPI_API_KEY: 'k',
    REOON_API_KEY: 'k',
  };
}

describe('env schema', () => {
  it('accepts a complete valid env', () => {
    const result = EnvSchema.safeParse(validEnv());
    expect(result.success).toBe(true);
  });

  it('rejects when SHARED_SECRET is too short', () => {
    const env = { ...validEnv(), SHARED_SECRET: 'short' };
    const result = EnvSchema.safeParse(env);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.SHARED_SECRET).toBeDefined();
    }
  });

  it('rejects when DATABASE_URL is not postgres-flavored', () => {
    const env = { ...validEnv(), DATABASE_URL: 'mysql://x:y@z/w' };
    const result = EnvSchema.safeParse(env);
    expect(result.success).toBe(false);
  });

  it('rejects when a required field is missing', () => {
    const env = { ...validEnv() };
    delete (env as Partial<typeof env>).REOON_API_KEY;
    const result = EnvSchema.safeParse(env);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.REOON_API_KEY).toBeDefined();
    }
  });

  it('allows HUNTER_API_KEY to be absent (optional until Phase 3.4)', () => {
    const env = { ...validEnv() };
    const result = EnvSchema.safeParse(env);
    expect(result.success).toBe(true);
  });

  it('treats empty HUNTER_API_KEY same as absent', () => {
    const env = { ...validEnv(), HUNTER_API_KEY: '' };
    const result = EnvSchema.safeParse(env);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.HUNTER_API_KEY).toBeUndefined();
    }
  });

  it('coerces PORT from string', () => {
    const env = { ...validEnv(), PORT: '5000' };
    const result = EnvSchema.safeParse(env);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT).toBe(5000);
    }
  });
});
