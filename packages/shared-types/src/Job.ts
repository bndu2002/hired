/**
 * Job type — scraped from Happy Agent via Alt+H.
 *
 * Mirrors the `jobs` table in apps/server/src/db/schema.sql after migrations
 * 0001 + 0002. See .kiro/specs/hired/design.md § 5.
 *
 * All extra fields (happyJobId, experienceRange, locationHint, postedHint) are
 * optional — paste-link flow or markup drift may leave them unset.
 */

export type JobSource = 'happy_agent' | 'paste_link';

export interface Job {
  id: number;
  source: JobSource;
  companyName: string;
  jobTitle: string;
  jobUrl: string;                       // LinkedIn / canonical posting URL
  jobDescription?: string;              // plain text, paragraphs separated by \n\n
  mustHaveSkills?: string;
  goodToHaveSkills?: string;
  happyJobId?: string;
  experienceRange?: string;
  locationHint?: string;
  postedHint?: string;
  createdAt: string;                    // ISO timestamp
}

/**
 * The payload the extension POSTs to /api/jobs/run-via-hired.
 * Server validates with Zod before trusting any of these fields.
 *
 * Note: `?: T | undefined` (not `?: T`) because JSON parsing + Zod produce
 * explicit-undefined values. Our tsconfig uses exactOptionalPropertyTypes,
 * so we have to allow both "absent" and "present-but-undefined" here.
 */
export interface RunViaHiredPayload {
  source: JobSource;
  companyName: string;
  jobTitle: string;
  jobUrl: string;
  jobDescription?: string | undefined;
  mustHaveSkills?: string | undefined;
  goodToHaveSkills?: string | undefined;
  happyJobId?: string | undefined;
  experienceRange?: string | undefined;
  locationHint?: string | undefined;
  postedHint?: string | undefined;
}

/** Response from /api/jobs/run-via-hired. */
export interface RunViaHiredResponse {
  jobId: number;
  isNew: boolean;              // false if we upserted an existing row
}
