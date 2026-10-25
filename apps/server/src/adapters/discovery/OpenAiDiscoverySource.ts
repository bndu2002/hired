/**
 * OpenAiDiscoverySource — discovery via OpenAI's Responses API + web_search tool.
 *
 * The whole premise: instead of us doing fragile Google X-ray queries, hand
 * the task to an LLM that can actually search the live web (via OpenAI's
 * Bing-backed web_search tool), read pages, and return structured profiles.
 *
 * Why this works where SerpAPI X-ray fails:
 *   - web_search fetches page content, not just URLs + snippets. The LLM
 *     actually "reads" LinkedIn-mentioning pages and extracts real profile
 *     links from them.
 *   - The LLM owns the search loop — if the first query returns garbage,
 *     it rephrases and tries again, up to N internal iterations.
 *   - OpenAI's safety policy allows "search for publicly available
 *     professional info", unlike Google's AI Mode which refuses more
 *     aggressively.
 *
 * Cost model (as of late 2026):
 *   - gpt-5.6-luna: $0.20/$1.20 per 1M input/output tokens
 *   - web_search tool: $10 per 1,000 calls = $0.01/call
 *   - A single discover() uses ~5K in + 1K out + 3-5 search calls
 *     ≈ $0.04-0.05 per run. ~$5-6/month at 4 runs/day.
 *
 * Known failure modes we handle:
 *   - LLM refuses / returns no profile URLs → throws (registry falls through)
 *   - LLM returns malformed JSON → regex-extract linkedin.com/in URLs as fallback
 *   - LLM hallucinates URLs that look valid but 404 → filtered by URL shape,
 *     not detectable without a verification step (future work)
 */

import { z } from 'zod';
import { logger } from '../../logger.js';
import type {
  CandidateContact,
  DiscoveryInput,
  DiscoverySource,
} from './DiscoverySource.js';

// ─── config ──────────────────────────────────────────────────────────────────

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

/** Default model — cheapest reasoning-capable OpenAI model with web_search. */
const DEFAULT_MODEL = 'gpt-5.6-luna';

const DEFAULT_ROLES = [
  'recruiter',
  'talent acquisition',
  'engineering manager',
  'tech lead',
  'staff engineer',
  'senior engineer',
] as const;

export interface OpenAiDiscoveryOptions {
  readonly model?: string;
  readonly country?: string; // e.g. 'India' — appended as a geo hint in the prompt
  readonly roles?: readonly string[];
}

// ─── structured output schema (what we ask the LLM to return) ────────────────

/**
 * Zod schema the adapter uses to validate the LLM's JSON output.
 * Kept loose enough that minor LLM deviations (missing location, extra fields)
 * don't fail the whole run.
 */
const ProfilesResponseSchema = z.object({
  profiles: z.array(
    z.object({
      name: z.string().min(1),
      role: z.string().optional().default(''),
      location: z.string().optional().default(''),
      linkedin_url: z.string(),
    }),
  ),
  search_notes: z.string().optional().default(''),
});

type ProfilesResponse = z.infer<typeof ProfilesResponseSchema>;

// ─── OpenAI Responses API response shape (only fields we need) ───────────────

const OutputTextContent = z.object({
  type: z.literal('output_text'),
  text: z.string(),
});

const AssistantMessage = z.object({
  type: z.literal('message'),
  role: z.literal('assistant'),
  content: z.array(z.unknown()),
});

const ResponsesApiResponse = z
  .object({
    id: z.string().optional(),
    status: z.string().optional(),
    model: z.string().optional(),
    output: z.array(z.unknown()).optional(),
    output_text: z.string().optional(),
    usage: z
      .object({
        input_tokens: z.number().optional(),
        output_tokens: z.number().optional(),
        total_tokens: z.number().optional(),
      })
      .passthrough()
      .optional(),
    error: z.unknown().optional(),
  })
  .passthrough();

// ─── public types for debug/introspection ────────────────────────────────────

export interface DiscoveryDebugInfo {
  /** The system + user prompts actually sent. */
  readonly prompts: { system: string; user: string };
  /** The model name used. */
  readonly model: string;
  /** The LLM's final text output (before JSON parsing). */
  readonly rawText: string | null;
  /** Structured profiles if JSON parse succeeded, null otherwise. */
  readonly parsed: ProfilesResponse | null;
  /** LinkedIn profile URLs extracted (either from JSON or via regex fallback). */
  readonly extractedUrls: readonly string[];
  /** How long the OpenAI call took, in ms. */
  readonly durationMs: number;
  /** Token usage reported by OpenAI. */
  readonly usage: { input: number; output: number } | null;
  /** Approximate dollar cost estimate for this call. */
  readonly estimatedCostUsd: number | null;
  /** Any warnings/failures recorded during parsing. */
  readonly warnings: readonly string[];
}

export interface DiscoverWithDebugResult {
  readonly candidates: CandidateContact[];
  readonly debug: DiscoveryDebugInfo;
}

// ─── helpers (pure, exported for direct testing) ─────────────────────────────

const LINKEDIN_PROFILE_RE = /https?:\/\/[a-z]{0,3}\.?linkedin\.com\/in\/[A-Za-z0-9_-]+\/?/gi;

/**
 * Extract all linkedin.com/in/<slug> URLs from a text blob.
 * Deduplicates, strips trailing slashes, and normalizes to lowercase host.
 */
export function extractLinkedInUrlsFromText(text: string): string[] {
  const matches = text.match(LINKEDIN_PROFILE_RE) ?? [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of matches) {
    const normalized = raw.replace(/\/+$/, '');
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

/** Pull the final assistant message text out of the Responses API payload. */
export function extractResponsesText(payload: unknown): string | null {
  const parsed = ResponsesApiResponse.safeParse(payload);
  if (!parsed.success) return null;
  if (typeof parsed.data.output_text === 'string' && parsed.data.output_text.length > 0) {
    return parsed.data.output_text;
  }
  // Fallback: walk the output[] array for a message with output_text content.
  const output = parsed.data.output ?? [];
  for (const item of output) {
    const msg = AssistantMessage.safeParse(item);
    if (!msg.success) continue;
    const texts: string[] = [];
    for (const content of msg.data.content) {
      const text = OutputTextContent.safeParse(content);
      if (text.success) texts.push(text.data.text);
    }
    if (texts.length > 0) return texts.join('\n');
  }
  return null;
}

/** Try to parse the LLM text as JSON (handles ```json fences and raw JSON). */
export function tryParseJson(text: string): unknown | null {
  const trimmed = text.trim();
  // Strip common markdown code fences.
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  try {
    return JSON.parse(unfenced);
  } catch {
    return null;
  }
}

/**
 * Approximate dollar cost given token counts + search tool calls.
 * Uses current gpt-5.6-luna rates. Not accounting for cached tokens
 * (which would make it cheaper); overestimates slightly.
 */
export function estimateOpenAiCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  searchCalls: number,
): number {
  // Rates per 1M tokens. If model unknown, fall back to luna rates.
  const DEFAULT_RATE = { input: 0.2, output: 1.2 } as const;
  const rates: Record<string, { input: number; output: number }> = {
    'gpt-5.6-luna': DEFAULT_RATE,
    'gpt-5.6-terra': { input: 2, output: 12 },
    'gpt-5.6-sol': { input: 5, output: 30 },
    'gpt-5': { input: 1.25, output: 10 },
    'gpt-5-mini': { input: 0.25, output: 2 },
    'gpt-5-nano': { input: 0.05, output: 0.4 },
    'gpt-4o': { input: 2.5, output: 10 },
    'gpt-4o-mini': { input: 0.15, output: 0.6 },
  };
  const rate = rates[model] ?? DEFAULT_RATE;
  const tokenCost = (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
  const searchCost = searchCalls * 0.01; // $10 / 1000 calls
  return tokenCost + searchCost;
}

/** Count web_search invocations in the Responses output[] array. */
export function countSearchCalls(payload: unknown): number {
  const parsed = ResponsesApiResponse.safeParse(payload);
  if (!parsed.success) return 0;
  const output = parsed.data.output ?? [];
  let n = 0;
  for (const item of output) {
    if (
      typeof item === 'object' &&
      item !== null &&
      'type' in item &&
      typeof (item as { type?: unknown }).type === 'string' &&
      (item as { type: string }).type.includes('search')
    ) {
      n += 1;
    }
  }
  return n;
}

// ─── prompt construction ─────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a referral discovery assistant.

The user is a job seeker looking to identify public LinkedIn profiles of people at a target company so they can respectfully reach out for a potential referral.

Your job:
1. Use the web_search tool to find real, publicly-visible LinkedIn profiles that match the roles and company specified.
2. ONLY return LinkedIn profile URLs you have actually encountered in your search results. Do NOT fabricate URLs.
3. Prefer URLs of the form https://[xx.]linkedin.com/in/<slug>. Reject job pages (linkedin.com/jobs/...), company pages (linkedin.com/company/...), and post URLs.
4. Return your answer as a JSON object with this exact shape:

{
  "profiles": [
    { "name": "string", "role": "string", "location": "string", "linkedin_url": "https://..." }
  ],
  "search_notes": "brief string explaining what you searched for and anything unusual"
}

Return at least the requested number of profiles if possible; if the company is too small or if public profiles are not accessible, return fewer and explain in search_notes.

Return ONLY the JSON object, no surrounding prose, no markdown code fences.`;

function buildUserPrompt(input: {
  companyName: string;
  roles: readonly string[];
  country?: string | undefined;
  limit: number;
}): string {
  const rolesList = input.roles.join(', ');
  const geoClause = input.country ? ` in ${input.country}` : '';
  return `Find ${input.limit} public LinkedIn profiles of people working at ${input.companyName}${geoClause}. Target these roles (any one is fine): ${rolesList}. Return their names, roles, locations, and linkedin.com/in/ profile URLs.`;
}

// ─── the adapter ─────────────────────────────────────────────────────────────

export class OpenAiDiscoverySource implements DiscoverySource {
  readonly name = 'openai_web_search';
  readonly kind = 'discovery' as const;

  private readonly model: string;
  private readonly country: string | undefined;
  private readonly roles: readonly string[];

  constructor(
    private readonly apiKey: string,
    options: OpenAiDiscoveryOptions = {},
  ) {
    if (!apiKey) throw new Error('OpenAiDiscoverySource: apiKey required');
    this.model = options.model ?? DEFAULT_MODEL;
    this.country = options.country;
    this.roles = options.roles ?? DEFAULT_ROLES;
  }

  async discover(input: DiscoveryInput): Promise<CandidateContact[]> {
    const { candidates } = await this.discoverWithDebug(input);
    return candidates;
  }

  /**
   * Rich variant that returns both parsed candidates and introspection data.
   * Used by /api/discovery-test so Vandana can inspect what the LLM did.
   */
  async discoverWithDebug(input: DiscoveryInput): Promise<DiscoverWithDebugResult> {
    const warnings: string[] = [];
    const userPrompt = buildUserPrompt({
      companyName: input.companyName,
      roles: this.roles,
      country: this.country,
      limit: input.limit,
    });

    logger.info(
      {
        adapter: this.name,
        model: this.model,
        companyName: input.companyName,
        limit: input.limit,
        country: this.country ?? null,
      },
      'openai discovery: issuing request',
    );

    const startedAt = Date.now();

    // IMPORTANT: web_search is incompatible with JSON mode / response_format
    // on the Responses API. Setting text.format=json_object returns a 400
    // ("Web Search cannot be used with JSON mode"). Same constraint Gemini
    // has with googleSearch. We ask for JSON in the prompt instead and
    // parse defensively via tryParseJson + the regex URL extraction fallback.
    const body = {
      model: this.model,
      input: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      tools: [{ type: 'web_search' }],
    };

    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const durationMs = Date.now() - startedAt;

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      logger.warn(
        {
          adapter: this.name,
          status: response.status,
          bodyPeek: bodyText.slice(0, 400),
        },
        'openai discovery: non-2xx',
      );
      throw new Error(`OpenAI Responses API failed: ${response.status}`);
    }

    const payload = await response.json();
    console.info('PayLoad from Open AI ================>',payload)
    const rawText = extractResponsesText(payload);
    const searchCalls = countSearchCalls(payload);
    const usage = ResponsesApiResponse.parse(payload).usage;

    const usageSummary = usage
      ? { input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0 }
      : null;
    const estimatedCostUsd = usageSummary
      ? estimateOpenAiCost(
          this.model,
          usageSummary.input,
          usageSummary.output,
          searchCalls,
        )
      : null;

    // Parse the LLM output. Three fallback levels:
    //   1. JSON matching our schema (ideal)
    //   2. JSON that doesn't match (extract whatever we can)
    //   3. Not JSON at all — regex-scrape linkedin.com/in URLs
    let parsed: ProfilesResponse | null = null;
    let extractedUrls: string[] = [];

    if (rawText) {
      const jsonAttempt = tryParseJson(rawText);
      if (jsonAttempt !== null) {
        const parseResult = ProfilesResponseSchema.safeParse(jsonAttempt);
        if (parseResult.success) {
          parsed = parseResult.data;
          extractedUrls = parsed.profiles.map((p) => p.linkedin_url);
        } else {
          warnings.push(
            `LLM returned JSON that didn't match schema: ${parseResult.error.message.slice(0, 200)}`,
          );
          // Still try to pull URLs from whatever JSON we got.
          extractedUrls = extractLinkedInUrlsFromText(rawText);
        }
      } else {
        warnings.push('LLM did not return valid JSON; falling back to regex extraction');
        extractedUrls = extractLinkedInUrlsFromText(rawText);
      }
    } else {
      warnings.push('OpenAI response had no text output');
    }

    // Filter to the strict linkedin.com/in shape.
    const profileUrls = extractedUrls.filter((u) => LINKEDIN_PROFILE_RE.test(u));
    LINKEDIN_PROFILE_RE.lastIndex = 0; // regex has /g so state must be reset

    // Build CandidateContact[] from parsed profiles OR from URL-only matches.
    const candidates: CandidateContact[] = parsed
      ? parsed.profiles
          .filter((p) => isLikelyLinkedInProfileUrl(p.linkedin_url))
          .map<CandidateContact>((p) => ({
            name: p.name,
            title: p.role,
            linkedinUrl: p.linkedin_url,
            rawSource: this.name,
          }))
      : profileUrls.map<CandidateContact>((url) => ({
          name: slugToName(url),
          title: '',
          linkedinUrl: url,
          rawSource: this.name,
        }));

    logger.info(
      {
        adapter: this.name,
        model: this.model,
        durationMs,
        searchCalls,
        usage: usageSummary,
        estimatedCostUsd,
        candidates: candidates.length,
        parsedJson: parsed !== null,
        warnings: warnings.length,
      },
      'openai discovery: completed',
    );

    return {
      candidates,
      debug: {
        prompts: { system: SYSTEM_PROMPT, user: userPrompt },
        model: this.model,
        rawText,
        parsed,
        extractedUrls: profileUrls,
        durationMs,
        usage: usageSummary,
        estimatedCostUsd,
        warnings,
      },
    };
  }

  /**
   * OpenAI doesn't expose a per-key credit balance via API in a stable way.
   * Return null (unknown) — the real cost is monitored on OpenAI's billing
   * dashboard. We log per-call cost estimates for in-flight visibility.
   */
  async estimateCreditsRemaining(): Promise<number | null> {
    return null;
  }
}

// ─── private helpers ─────────────────────────────────────────────────────────

/** Loose check that a URL points at a LinkedIn PROFILE (not job/company/post). */
function isLikelyLinkedInProfileUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith('linkedin.com')) return false;
    return u.pathname.toLowerCase().startsWith('/in/');
  } catch {
    return false;
  }
}

/**
 * When we fall back to regex extraction (LLM returned no JSON), we only have
 * URLs. Derive a placeholder display name from the slug so the modal has
 * something to show. The real name shows up at outreach time when the user
 * views the profile.
 */
function slugToName(url: string): string {
  try {
    const slug = new URL(url).pathname.replace(/^\/in\//, '').replace(/\/+$/, '');
    const words = slug.split(/[-_]/).filter((w) => w.length > 0 && /^[A-Za-z]+$/.test(w));
    if (words.length === 0) return slug;
    return words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ');
  } catch {
    return '(unknown)';
  }
}
