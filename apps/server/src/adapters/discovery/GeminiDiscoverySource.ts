/**
 * GeminiDiscoverySource — discovery via Google Gemini + Grounding with Google Search.
 *
 * Same idea as OpenAiDiscoverySource but using Gemini's native search grounding
 * instead of OpenAI's web_search tool. Advantage: free on Gemini 2.5 Flash's
 * free tier (1500 req/day). Disadvantage: same underlying Google search
 * de-indexing issues we hit with Google AI Mode, since this is Google's own
 * search layer. Hit rate may be lower than OpenAI's Bing-backed web_search.
 *
 * API endpoint:
 *   POST https://generativelanguage.googleapis.com/v1beta/models/
 *        {model}:generateContent?key={GEMINI_API_KEY}
 *
 * Important constraint: Gemini does NOT support `responseMimeType: application/json`
 * in combination with the `googleSearch` grounding tool. If you set both, the
 * API returns a 400. So we ask for JSON in the prompt and parse defensively
 * — same 3-level fallback as the OpenAI adapter.
 *
 * Known failure modes:
 *   - Grounding refuses / Gemini says it can't list individuals → throws
 *   - Returns markdown / prose instead of JSON → regex-extract URLs
 *   - Lower hit rate on big companies (same Google search decay issue)
 */

import { z } from 'zod';
import { logger } from '../../logger.js';
import type {
  CandidateContact,
  DiscoveryInput,
  DiscoverySource,
} from './DiscoverySource.js';
import {
  extractLinkedInUrlsFromText,
  tryParseJson,
} from './OpenAiDiscoverySource.js';

// ─── config ──────────────────────────────────────────────────────────────────

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Default model — Gemini 3.8 Flash is the current latest for new API users.
 * Older 2.5 Flash was retired for new accounts in late 2026. Can be
 * overridden via the `model` field in the discoverer options or the
 * discovery-test request body.
 */
const DEFAULT_MODEL = 'gemini-3.8-flash';

const DEFAULT_ROLES = [
  'recruiter',
  'talent acquisition',
  'engineering manager',
  'tech lead',
  'staff engineer',
  'senior engineer',
] as const;

export interface GeminiDiscoveryOptions {
  readonly model?: string;
  readonly country?: string;
  readonly roles?: readonly string[];
}

// ─── Gemini response schema (only fields we need) ────────────────────────────

const GroundingChunk = z.object({
  web: z
    .object({
      uri: z.string(),
      title: z.string().optional(),
    })
    .optional(),
});

const GroundingMetadata = z
  .object({
    webSearchQueries: z.array(z.string()).optional(),
    groundingChunks: z.array(GroundingChunk).optional(),
  })
  .passthrough();

const Candidate = z
  .object({
    content: z
      .object({
        parts: z
          .array(
            z
              .object({
                text: z.string().optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .optional(),
    groundingMetadata: GroundingMetadata.optional(),
    finishReason: z.string().optional(),
  })
  .passthrough();

const GeminiResponse = z
  .object({
    candidates: z.array(Candidate).optional(),
    usageMetadata: z
      .object({
        promptTokenCount: z.number().optional(),
        candidatesTokenCount: z.number().optional(),
        totalTokenCount: z.number().optional(),
      })
      .passthrough()
      .optional(),
    error: z.unknown().optional(),
  })
  .passthrough();

// ─── structured output we try to coax from Gemini ────────────────────────────

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

// ─── public types for debug/introspection ────────────────────────────────────

export interface GeminiGroundingInfo {
  readonly webSearchQueries: readonly string[];
  readonly groundingSources: readonly { title: string; uri: string }[];
}

export interface GeminiDiscoveryDebugInfo {
  readonly prompts: { system: string; user: string };
  readonly model: string;
  readonly rawText: string | null;
  readonly parsed: ProfilesResponse | null;
  readonly extractedUrls: readonly string[];
  readonly durationMs: number;
  readonly usage: { input: number; output: number } | null;
  readonly estimatedCostUsd: number | null;
  readonly grounding: GeminiGroundingInfo | null;
  readonly warnings: readonly string[];
}

export interface DiscoverWithDebugResult {
  readonly candidates: CandidateContact[];
  readonly debug: GeminiDiscoveryDebugInfo;
}

// ─── prompt construction ─────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a referral discovery assistant.

The user is a job seeker looking to identify public LinkedIn profiles of people at a target company so they can respectfully reach out for a potential referral.

Your job:
1. Use Google Search grounding to find real, publicly-visible LinkedIn profiles that match the roles and company specified.
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

// ─── cost estimation ─────────────────────────────────────────────────────────

/**
 * Estimate dollar cost for a Gemini generateContent call with grounding.
 *
 * Gemini 2.5 Flash free tier covers both tokens and grounding up to the
 * daily/minute quotas (1500 req/day). Beyond free tier, published rates
 * apply. For a $0-budget R&D test, this returns ~0 for free-tier calls.
 *
 * Rates (per Google's pricing, late 2026, paid tier):
 *   - gemini-2.5-flash: $0.075/$0.30 per 1M input/output tokens
 *   - Grounding with Google Search: $35 per 1,000 requests (beyond free tier)
 */
export function estimateGeminiCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  grounded: boolean,
): number {
  // Rates best-effort as of late 2026. Gemini 3.x pricing is close to 2.5
  // Flash's. Verify at https://ai.google.dev/pricing before trusting the
  // cost column on this adapter's debug output for anything other than
  // rough comparison.
  const DEFAULT_RATE = { input: 0.075, output: 0.3 } as const;
  const rates: Record<string, { input: number; output: number }> = {
    'gemini-3.8-flash': DEFAULT_RATE,
    'gemini-2.5-flash': DEFAULT_RATE,
    'gemini-2.5-flash-lite': { input: 0.038, output: 0.15 },
    'gemini-2.5-pro': { input: 1.25, output: 10 },
    'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  };
  const rate = rates[model] ?? DEFAULT_RATE;
  const tokenCost = (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
  // Grounding billed as 1 request on paid tier. Free tier: $0.
  const groundingCost = grounded ? 0.035 : 0;
  return tokenCost + groundingCost;
}

// ─── the adapter ─────────────────────────────────────────────────────────────

export class GeminiDiscoverySource implements DiscoverySource {
  readonly name = 'gemini_grounded';
  readonly kind = 'discovery' as const;

  private readonly model: string;
  private readonly country: string | undefined;
  private readonly roles: readonly string[];

  constructor(
    private readonly apiKey: string,
    options: GeminiDiscoveryOptions = {},
  ) {
    if (!apiKey) throw new Error('GeminiDiscoverySource: apiKey required');
    this.model = options.model ?? DEFAULT_MODEL;
    this.country = options.country;
    this.roles = options.roles ?? DEFAULT_ROLES;
  }

  async discover(input: DiscoveryInput): Promise<CandidateContact[]> {
    const { candidates } = await this.discoverWithDebug(input);
    return candidates;
  }

  /**
   * Rich variant with introspection. Used by /api/discovery-test so
   * Vandana can inspect prompts, grounding queries, raw text, parsed JSON.
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
      'gemini discovery: issuing request',
    );

    const url = `${GEMINI_BASE_URL}/${this.model}:generateContent?key=${this.apiKey}`;

    // NOTE: Do NOT set responseMimeType=application/json alongside googleSearch —
    // the API rejects that combo. Prompt asks for JSON instead.
    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      tools: [{ googleSearch: {} }],
      generationConfig: {
        temperature: 0,
      },
    };

    const startedAt = Date.now();
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
        'gemini discovery: non-2xx',
      );
      throw new Error(`Gemini generateContent failed: ${response.status}`);
    }

    const payload = await response.json();
    const parsedPayload = GeminiResponse.safeParse(payload);
    if (!parsedPayload.success) {
      throw new Error(`Gemini returned unparseable response: ${parsedPayload.error.message}`);
    }

    // Pull the LLM's text answer out of the candidate parts.
    const firstCandidate = parsedPayload.data.candidates?.[0];
    const parts = firstCandidate?.content?.parts ?? [];
    const rawText =
      parts
        .map((p) => (typeof p.text === 'string' ? p.text : ''))
        .filter(Boolean)
        .join('\n') || null;

    // Extract grounding metadata for debug surfaces.
    const groundingMeta = firstCandidate?.groundingMetadata;
    const grounding: GeminiGroundingInfo | null = groundingMeta
      ? {
          webSearchQueries: groundingMeta.webSearchQueries ?? [],
          groundingSources: (groundingMeta.groundingChunks ?? [])
            .map((c) => c.web)
            .filter((w): w is { uri: string; title?: string } => Boolean(w))
            .map((w) => ({ title: w.title ?? '', uri: w.uri })),
        }
      : null;

    const usage = parsedPayload.data.usageMetadata;
    const usageSummary = usage
      ? {
          input: usage.promptTokenCount ?? 0,
          output: usage.candidatesTokenCount ?? 0,
        }
      : null;
    const estimatedCostUsd = usageSummary
      ? estimateGeminiCost(
          this.model,
          usageSummary.input,
          usageSummary.output,
          grounding !== null,
        )
      : null;

    // Parse the LLM output — same 3-level fallback as the OpenAI adapter.
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
            `Gemini returned JSON that didn't match schema: ${parseResult.error.message.slice(0, 200)}`,
          );
          extractedUrls = extractLinkedInUrlsFromText(rawText);
        }
      } else {
        warnings.push('Gemini did not return valid JSON; falling back to regex extraction');
        extractedUrls = extractLinkedInUrlsFromText(rawText);
      }
    } else {
      warnings.push('Gemini response had no text content');
    }

    const profileUrls = extractedUrls.filter(isLikelyLinkedInProfileUrl);

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
        usage: usageSummary,
        estimatedCostUsd,
        candidates: candidates.length,
        parsedJson: parsed !== null,
        groundingQueries: grounding?.webSearchQueries.length ?? 0,
        groundingSources: grounding?.groundingSources.length ?? 0,
        warnings: warnings.length,
      },
      'gemini discovery: completed',
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
        grounding,
        warnings,
      },
    };
  }

  /**
   * Gemini's free-tier quota is daily (1500 req/day for 2.5 Flash) and not
   * exposed via API. Return null — treat it as unlimited for our telemetry.
   */
  async estimateCreditsRemaining(): Promise<number | null> {
    return null;
  }
}

// ─── private helpers ─────────────────────────────────────────────────────────

function isLikelyLinkedInProfileUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith('linkedin.com')) return false;
    return u.pathname.toLowerCase().startsWith('/in/');
  } catch {
    return false;
  }
}

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
