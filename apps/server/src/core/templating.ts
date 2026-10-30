/**
 * Pure Mustache-lite template renderer for outreach messages.
 *
 * Supports a single feature: `{{variableName}}` substitution. Enough for
 * LinkedIn connect requests, LinkedIn DMs, and Gmail email bodies.
 *
 * Design choices:
 *
 *   - **Throws on unresolved variables.** A template with `{{foo}}` and no
 *     `foo` in vars is a programmer / config error, not something to render
 *     to a human. Fail loud at render time so Vandana's recruiter doesn't
 *     receive "Hi {{outreachEmployeeName}}, I saw your {{jobTitle}} role...".
 *     Error lists ALL missing vars (not just the first) so a bad template
 *     surfaces in one shot.
 *
 *   - **Variable names are strict identifiers.** `[A-Za-z_][A-Za-z0-9_]*`.
 *     No dotted paths (`{{job.title}}`), no helpers (`{{#if …}}`). Simple is
 *     better than a template engine we'll regret.
 *
 *   - **Whitespace tolerated inside braces.** `{{ foo }}` matches `{{foo}}`.
 *     Users write templates by hand; mild sloppiness shouldn't break them.
 *
 *   - **Values are inserted as-is.** No HTML escaping — LinkedIn DMs are
 *     plain text, and Gmail HTML bodies are built by a separate concern.
 *     If a Gmail HTML template ever needs escaping, the caller passes
 *     pre-escaped values. Keeping escape policy out of core/ matches the
 *     "pure, no I/O" rule.
 *
 *   - **No side effects.** This file sits in core/ and is unit-testable.
 *
 * No I/O here. See .kiro/specs/hired/design.md § core-vs-services.
 */

// ─── types ───────────────────────────────────────────────────────────────────

export type TemplateVars = Readonly<Record<string, string>>;

/** Thrown when a template references variables not present in `vars`. */
export class UnresolvedTemplateVarsError extends Error {
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    super(
      `template has unresolved variables: ${missing.join(', ')} (pass them in vars, or remove from template)`,
    );
    this.name = 'UnresolvedTemplateVarsError';
    this.missing = missing;
  }
}

// ─── regex ──────────────────────────────────────────────────────────────────

/**
 * Match `{{name}}` or `{{  name  }}`. Captures the identifier.
 *
 * Anchored on `[A-Za-z_][A-Za-z0-9_]*` — same rule as JS identifiers minus
 * `$`. `$` would collide with the replacement-string metachars used by
 * `String.prototype.replace` and complicate escaping; no legitimate template
 * variable needs `$` in its name.
 */
const VAR_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

// ─── public API ─────────────────────────────────────────────────────────────

/**
 * Render a template string against a variable bag.
 *
 * @example
 *   render('Hi {{name}}, saw your {{role}} opening.', { name: 'Rahul', role: 'Senior Dev' })
 *   // → "Hi Rahul, saw your Senior Dev opening."
 *
 * @throws {UnresolvedTemplateVarsError} if the template references variables
 *   not present in `vars`. The error's `.missing` lists every unresolved
 *   variable (deduplicated, in order of first appearance).
 */
export function render(template: string, vars: TemplateVars): string {
  const missing: string[] = [];
  const missingSeen = new Set<string>();

  // First pass: collect every unresolved variable so we can report them all
  // in one error (better signal than failing on the first).
  for (const match of template.matchAll(VAR_RE)) {
    const name = match[1];
    if (!name) continue; // defensive: regex guarantees a capture, but noUncheckedIndexedAccess
    if (!(name in vars) && !missingSeen.has(name)) {
      missing.push(name);
      missingSeen.add(name);
    }
  }

  if (missing.length > 0) {
    throw new UnresolvedTemplateVarsError(missing);
  }

  // Second pass: substitute. Use a callback (not a replacement string) so
  // `$1` / `$&` inside values don't get interpreted as backreferences.
  return template.replace(VAR_RE, (_full, name: string) => {
    const value = vars[name];
    // Guard against undefined slipping through (shouldn't be possible after
    // the first-pass check, but exactOptionalPropertyTypes + strict let us
    // prove it).
    if (value === undefined) {
      throw new UnresolvedTemplateVarsError([name]);
    }
    return value;
  });
}

/**
 * Scan a template and return every variable name it references. Useful for
 * the Configure UI ("your template uses: outreachEmployeeName, jobTitle…"),
 * for validating that a template only references supported variables, and
 * for building a form of input prompts without hand-maintaining a list.
 *
 * Order of first appearance; deduplicated.
 */
export function extractVariableNames(template: string): readonly string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const match of template.matchAll(VAR_RE)) {
    const name = match[1];
    if (!name) continue;
    if (!seen.has(name)) {
      names.push(name);
      seen.add(name);
    }
  }
  return names;
}
