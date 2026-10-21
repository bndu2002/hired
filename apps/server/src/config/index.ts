/**
 * Env parsing. Runs ONCE at boot and exposes a typed `config` object.
 *
 * Convention: nothing else in the codebase reads `process.env` directly.
 * All consumers import `config` from here. See coding-standards.md § env.
 *
 * If any required var is missing or malformed, the process exits with code 1
 * BEFORE Express starts. We'd rather fail loud at boot than serve traffic
 * with a half-functional server (coding-standards.md § error handling).
 */

import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Resolve workspace root — this file lives at apps/server/src/config/index.ts,
// so three levels up is the workspace root where .env lives.
const here = fileURLToPath(new URL('.', import.meta.url));
const envPath = resolve(here, '../../../../.env');
dotenvConfig({ path: envPath });

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  // 32-byte hex = 64 chars; also accept arbitrary 32+ char strings during dev
  SHARED_SECRET: z
    .string()
    .min(32, 'SHARED_SECRET must be at least 32 characters'),

  DATABASE_URL: z
    .string()
    .url()
    .refine((v) => v.startsWith('postgres'), {
      message: 'DATABASE_URL must be a postgres:// or postgresql:// URL',
    }),

  // Google OAuth (Gmail) + Gemini
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().url(),
  GEMINI_API_KEY: z.string().min(1),

  // Discovery
  SERPAPI_API_KEY: z.string().min(1),

  // Email finder — Snov.io (OAuth2 client credentials, not a single API key).
  // Both optional at the schema level so you can run the server without Snov
  // configured (SnovFinder won't register, PatternHeuristicFinder covers).
  // Treat empty string the same as missing — allows `KEY=` in .env.
  SNOV_CLIENT_ID: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).optional(),
  ),
  SNOV_CLIENT_SECRET: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).optional(),
  ),

  // Email verifier
  REOON_API_KEY: z.string().min(1),
});

export type Config = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error(
    '❌ Env validation failed:\n',
    JSON.stringify(parsed.error.flatten().fieldErrors, null, 2),
  );
  // eslint-disable-next-line no-console
  console.error(
    `\n   Expected to load env from: ${envPath}\n   See .env.example for the complete list.\n`,
  );
  process.exit(1);
}

export const config: Config = parsed.data;
