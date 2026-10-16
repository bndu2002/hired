/**
 * Job repository — only place in the codebase that writes/reads `jobs`.
 * Routes and services go through these functions.
 *
 * Parameterized queries only (coding-standards.md § database).
 */

import type { Job, RunViaHiredPayload } from '@hired/types';
import { pool } from '../client.js';

interface JobRow {
  id: number;
  source: string;
  company_name: string;
  job_title: string;
  job_url: string;
  job_description: string | null;
  must_have_skills: string | null;
  good_to_have_skills: string | null;
  happy_job_id: string | null;
  experience_range: string | null;
  location_hint: string | null;
  posted_hint: string | null;
  created_at: Date;
}

function rowToJob(r: JobRow): Job {
  const job: Job = {
    id: r.id,
    source: r.source as Job['source'],
    companyName: r.company_name,
    jobTitle: r.job_title,
    jobUrl: r.job_url,
    createdAt: r.created_at.toISOString(),
  };
  if (r.job_description !== null) job.jobDescription = r.job_description;
  if (r.must_have_skills !== null) job.mustHaveSkills = r.must_have_skills;
  if (r.good_to_have_skills !== null) job.goodToHaveSkills = r.good_to_have_skills;
  if (r.happy_job_id !== null) job.happyJobId = r.happy_job_id;
  if (r.experience_range !== null) job.experienceRange = r.experience_range;
  if (r.location_hint !== null) job.locationHint = r.location_hint;
  if (r.posted_hint !== null) job.postedHint = r.posted_hint;
  return job;
}

/**
 * Insert or update a job by its `job_url`. Returns the resulting row and
 * whether this call created a new row (vs updated an existing one).
 *
 * Dedup key: job_url (the LinkedIn/canonical posting URL). Re-pressing Alt+H
 * on the same job refreshes the row's data in case Happy's copy changed.
 */
export async function upsertByUrl(
  payload: RunViaHiredPayload,
): Promise<{ job: Job; isNew: boolean }> {
  const result = await pool.query<JobRow & { was_insert: boolean }>(
    `
    INSERT INTO jobs (
      source, company_name, job_title, job_url, job_description,
      must_have_skills, good_to_have_skills,
      happy_job_id, experience_range, location_hint, posted_hint
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (job_url) DO UPDATE SET
      source              = EXCLUDED.source,
      company_name        = EXCLUDED.company_name,
      job_title           = EXCLUDED.job_title,
      job_description     = EXCLUDED.job_description,
      must_have_skills    = EXCLUDED.must_have_skills,
      good_to_have_skills = EXCLUDED.good_to_have_skills,
      happy_job_id        = EXCLUDED.happy_job_id,
      experience_range    = EXCLUDED.experience_range,
      location_hint       = EXCLUDED.location_hint,
      posted_hint         = EXCLUDED.posted_hint
    RETURNING *,
      (xmax = 0) AS was_insert
    `,
    [
      payload.source,
      payload.companyName,
      payload.jobTitle,
      payload.jobUrl,
      payload.jobDescription ?? null,
      payload.mustHaveSkills ?? null,
      payload.goodToHaveSkills ?? null,
      payload.happyJobId ?? null,
      payload.experienceRange ?? null,
      payload.locationHint ?? null,
      payload.postedHint ?? null,
    ],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('upsertByUrl: no row returned from RETURNING clause');
  }

  return { job: rowToJob(row), isNew: row.was_insert };
}

export async function listJobs(limit = 100): Promise<Job[]> {
  const result = await pool.query<JobRow>(
    'SELECT * FROM jobs ORDER BY created_at DESC LIMIT $1',
    [limit],
  );
  return result.rows.map(rowToJob);
}

export async function getJobById(id: number): Promise<Job | null> {
  const result = await pool.query<JobRow>('SELECT * FROM jobs WHERE id = $1', [id]);
  const row = result.rows[0];
  return row ? rowToJob(row) : null;
}
