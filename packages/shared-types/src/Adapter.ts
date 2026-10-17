/**
 * The three pluggable adapter interfaces that form the swap boundary (D4).
 *
 * Each kind — Discovery, EmailFinder, EmailVerifier — has one or more
 * implementations in `apps/server/src/adapters/<kind>/`. The orchestrator never
 * imports a concrete adapter; it goes through the provider registry.
 *
 * Adding a new adapter is a three-step change:
 *   1. New file under the right `adapters/<kind>/` folder implementing the interface.
 *   2. Register it in `services/providerRegistry.ts`.
 *   3. Seed its row in the `provider_credits` table.
 *
 * See `.kiro/specs/hired/design.md § 7-8` for the architectural reasoning.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Discovery — "who should I reach out to at CompanyX?"
// Returns candidate contacts with name + title + LinkedIn URL.
// ─────────────────────────────────────────────────────────────────────────────

export interface CandidateContact {
  /** Full name, e.g. "Arjun Mehta". */
  name: string;
  /** Role/title as found by the source, e.g. "Staff Software Engineer". */
  title: string;
  /** LinkedIn profile URL if the source produced one. */
  linkedinUrl?: string;
  /** Free-form tenure or recency hint, e.g. "2y at Appscrip". */
  tenureHint?: string;
  /** Name of the adapter that produced this result (for telemetry). */
  rawSource: string;
}

export interface DiscoveryInput {
  companyName: string;
  jobTitle: string;
  jobDescription?: string;
  /** Caller requests up to N candidates; adapter may return fewer. */
  limit: number;
}

export interface DiscoverySource {
  readonly name: string; // e.g. 'serpapi_xray'
  readonly kind: 'discovery';
  discover(input: DiscoveryInput): Promise<CandidateContact[]>;
  /**
   * Best-effort credit balance for this adapter. Return `null` when the
   * provider doesn't expose this or when the adapter is unlimited.
   */
  estimateCreditsRemaining(): Promise<number | null>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Email finder — "given a name and company domain, find the email."
// ─────────────────────────────────────────────────────────────────────────────

export interface EmailFindInput {
  firstName: string;
  lastName: string;
  companyDomain: string;
  /** Optional LinkedIn URL — some providers use it to raise accuracy. */
  linkedinUrl?: string;
}

export interface EmailFindResult {
  email: string;
  confidence: 'high' | 'medium' | 'low';
  rawSource: string;
}

export interface EmailFinder {
  readonly name: string; // e.g. 'hunter'
  readonly kind: 'email_finder';
  find(input: EmailFindInput): Promise<EmailFindResult | null>;
  estimateCreditsRemaining(): Promise<number | null>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Email verifier — "is this email actually deliverable?"
// We only send to `valid`. `accept_all` and `unknown` fall back to LinkedIn.
// D2 — see .kiro/specs/hired/requirements.md § 6.
// ─────────────────────────────────────────────────────────────────────────────

export type VerifyStatus = 'valid' | 'invalid' | 'accept_all' | 'unknown';

export interface VerifyResult {
  status: VerifyStatus;
  /** Human-readable reason, especially useful for `invalid`. */
  reason?: string;
  rawSource: string;
}

export interface EmailVerifier {
  readonly name: string; // e.g. 'reoon'
  readonly kind: 'email_verifier';
  verify(email: string): Promise<VerifyResult>;
  estimateCreditsRemaining(): Promise<number | null>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Discriminated union for provider telemetry
// ─────────────────────────────────────────────────────────────────────────────

export type ProviderKind = 'discovery' | 'email_finder' | 'email_verifier';

export type Adapter = DiscoverySource | EmailFinder | EmailVerifier;
