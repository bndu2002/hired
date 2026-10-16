# Coding standards — Hired

> Applies to all code in this workspace. If a rule here conflicts with `.kiro/specs/hired/design.md`, the design doc wins (and this file should be updated).

The goal is code I can re-read in three months and understand without the author in the room. Simplicity over cleverness, explicit over implicit, boring over novel.

---

## Language and compilation

- **TypeScript strict mode**, everywhere. `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true` in `tsconfig.base.json`.
- **No `any`**. If you need an escape hatch, use `unknown` and narrow with a type guard. The one legitimate `any` is in test fixtures where we explicitly want to bypass types.
- **No implicit `any` from imports**. If a dependency has no types, create a minimal `.d.ts` in `src/types/` rather than disabling checks for the file.
- **ES2022 target**, module resolution `bundler`. Native `Node:` protocol for Node builtins (`import { readFile } from 'node:fs/promises'`).
- **Zod at every I/O boundary**. HTTP requests, scraped payloads, third-party responses — all validated before entering the type system. "If TypeScript thinks it's a `string`, it's a `string`."

## File and folder conventions

The design doc explains the organization principles. The rules that follow from them:

- **`core/` is pure.** No `fs`, no `http`, no `pg`. If `core/` ever imports from `services/` or `db/` or `adapters/`, that's a bug.
- **`adapters/<kind>/<ProviderName>.ts`** — one adapter per file. Named after the provider in PascalCase. Alongside: `__tests__/<ProviderName>.test.ts` for the adapter's unit tests, and `__tests__/contract.test.ts` (shared) for the kind's interface contract.
- **`services/` composes.** A service may import from `core/`, `db/`, `adapters/`, and other `services/`. Services may not import from `routes/`.
- **`routes/` is thin.** A route handler is: validate input (Zod) → call a service → shape response. No business logic.
- **One default export per file is fine. One named export per file is better.** Easier to grep.
- **File names match their primary export.** `SerpApiXRaySource.ts` exports `SerpApiXRaySource`. `templating.ts` exports `render`.
- **No barrel re-exports except at package boundaries.** `packages/shared-types/src/index.ts` is a barrel; `apps/server/src/core/index.ts` is NOT. Barrels hide dependency graphs.

## Naming

- **PascalCase** for types, interfaces, classes, React components, enum names.
- **camelCase** for variables, functions, methods, instance names.
- **UPPER_SNAKE** for compile-time constants that represent fixed values (`DAILY_CAP = 4`). Runtime config loaded from env is not a constant — camelCase in the `config` object.
- **snake_case** for SQL — tables, columns, indexes. Keep JS/TS and SQL cosmetically distinct.
- **Prefix test files with the thing they test.** `scoring.ts` → `scoring.test.ts`. Not `test-scoring.ts`.
- **Boolean names imply yes/no.** `isSelected`, `hasEmail`, `canSend`. Not `selected` (ambiguous), not `enabled` as a verb.
- **Avoid abbreviations unless they're universal.** `linkedinUrl` not `liUrl`. `email` not `em`.

## Function and module signatures

- **Prefer named options object over positional args for anything with ≥ 3 params.** `send({ to, subject, body })` not `send(to, subject, body)`.
- **Return discriminated unions over throwing** for expected failure modes. An adapter's `verify()` returns `{ status: 'valid' | 'invalid' | 'accept_all' | 'unknown' }`; it doesn't throw on `invalid`.
- **Throw for programmer errors.** State machine transition violations, invalid config at boot, Zod validation of our own data. These shouldn't be caught — they should fail loud.
- **No implicit `undefined` in return types.** If a function can return nothing, make it explicit: `Promise<Contact | null>`.

## React conventions (`apps/web/`)

- **Function components only**, hooks for state.
- **One component per file**, named for the file.
- **Data fetching via TanStack Query hooks** in `shared/api/`. Components call hooks; they don't fetch directly.
- **No prop drilling beyond 2 levels.** If data needs to go deeper, lift to Query cache or a context (preferred: cache).
- **Tailwind utility-first.** Component-specific CSS files are a last resort. If a className list gets > ~10 utilities, extract via `clsx` + a local variable with a readable name.
- **Shared primitives in `shared/components/`.** Feature-specific components live inside their feature folder.

## Testing (do this while building, not after)

Three layers; each new feature touches at least two.

### What to test

- **`core/*`**: 100% behavior coverage. Pure functions, trivially testable.
- **`adapters/<kind>/<X>.ts`**: unit test with HTTP mocked via `nock`. Also runs under `contract.test.ts` automatically.
- **`services/*`**: integration tests with real test Postgres + mocked adapters.
- **`routes/*`**: integration via `supertest`. One happy path + one failure path per route.
- **`db/repositories/*`**: integration against test DB. Nothing clever, just assert reads/writes.

### How to test

- **Vitest, co-located** (`__tests__/` or `foo.test.ts` next to `foo.ts`). Prefer co-located for unit; `test/integration/` for integration.
- **Arrange-Act-Assert**, with blank lines between the three sections. One assert per logical thing.
- **Avoid shared state across tests.** Each test seeds its own data; `beforeEach` truncates the test DB.
- **No `sleep` or arbitrary timeouts.** Use `vi.waitFor` or deterministic triggers.
- **Snapshot tests are banned except for rendered output of pure template functions.** Snapshots on business logic rot silently.
- **Fixtures live in `test/fixtures/`** — named for what they contain (`happy_agent_jobs_page.html`, `serpapi_response.json`). Realistic data; don't hand-craft "clean" versions.

### Running tests

- Per package: `pnpm --filter server test`
- Watch while building: `pnpm --filter server test:watch`
- Whole workspace: `pnpm test`
- Pre-commit: workspace-level `pnpm test` on changed packages (via lint-staged or by hand)

## Error handling

- **Fail fast on boot**. Missing env var, DB unreachable, Google OAuth not configured → log error, exit non-zero. Don't start a half-functional server.
- **Routes always respond.** Every route handler is wrapped by `errorHandler` middleware. Unknown errors → 500 with a sanitized message and the error logged in full.
- **Services return `Result`-like types for expected failures.** `const result = await resolveContact(input); if (!result) { ... }`. Use `null` for "not found" (which is normal) and throw for "shouldn't happen."
- **Adapter failures are expected and non-fatal.** The provider registry handles them: when adapter N throws or returns null, fall through to adapter N+1.
- **No swallowed errors.** `catch { }` is forbidden. If you catch, you log at minimum.

## Logging

- **Pino, structured.** Every log line is a JSON object. No `console.log` in production code paths (fine in temporary debugging; remove before commit).
- **Levels used:**
  - `error` — something broke that shouldn't have. Alerting-worthy.
  - `warn` — recoverable degradation (adapter fell through, quota near depletion).
  - `info` — notable state changes (run started/completed, send dispatched, acceptance detected).
  - `debug` — step-by-step for development; disabled in prod.
- **Correlation IDs on every line.** HTTP requests get `requestId`; background jobs get `runId` / `contactId`.
- **No PII in log messages.** Reference contacts by their DB `id`, not name/email. If a payload must include identifying data, redact or log only in `debug`.

## Comments and documentation

- **JSDoc on every exported function in `services/`, `adapters/`, `core/`.** State what the function does, what it returns, what it throws. Example input welcome.
- **Comment the WHY, not the WHAT.** The code says what; the comment says why we chose this.
- **Reference decisions by number.** `// D1 — no scripted click here`.
- **TODO comments carry an owner and a reason.** `// TODO(vandana): extend when SerpApi adapter lands` not `// TODO: fix`.
- **Dead code is deleted, not commented out.** Git preserves history.

## Git and commits

- **One task per commit.** Scope matches `.kiro/specs/hired/tasks.md` task numbers.
- **Message format**: `phase-<N>.<task>: <short imperative description>`
  - Good: `phase-3.3: serpapi x-ray discovery adapter + contract test`
  - Bad: `fixes`, `WIP`, `updates`
- **Body optional** but welcome for anything that needs context in six months.
- **Branch main always boots.** If a task leaves `pnpm --filter server dev` or `pnpm --filter web dev` broken, finish or revert before committing.
- **No force-push to main**. No rewriting history that's been pushed.

## Env and secrets

- **Nothing secret in the repo.** `.env` is gitignored; `.env.example` lists required vars with placeholder values.
- **Env parsed once, at boot, via Zod** (`src/config/index.ts`). All other code imports the typed `config` object. No `process.env.X` scattered.
- **API keys loaded from env.** Never hardcoded, never checked in, never logged.

## Database

- **Raw SQL via `pg`** — see design.md § 3 for the "no ORM in v1" decision. Repositories wrap queries; routes don't touch SQL.
- **Parametrized queries only.** Never string-interpolate values into SQL. `$1, $2, $3` placeholders always.
- **Transactions when touching more than one table in one logical operation.** The dual-write pattern (event + status update) uses an explicit transaction.
- **Indexes on anything you'll filter or join by.** See schema.sql.
- **Migrations are append-only files**. Never edit a committed migration; always add a new one.

## Working with Kiro (AI pair-programming)

- **Before asking Kiro to write code, point at the relevant spec section.** `#File: .kiro/specs/hired/design.md` or ` #File tasks.md` as context grounds the output.
- **Review every generated file.** Specifically check: imports are from the right layer (no `routes/` → `db/` leaks), tests exist, Zod boundaries exist, no `any`.
- **If generated code deviates from this file, call it out and ask for a fix.** Fast feedback keeps the quality bar.
- **Keep `.kiro/specs/hired/tasks.md` tickboxes current.** Mark done as tasks pass tests. The spec is a living document.

---

## When this file changes

- A new rule gets a bullet; a reversed rule gets both the old and new in a short `## Changed from previous` note at the bottom of the relevant section. The point is traceability: "why does this file say X?" should always be answerable.
