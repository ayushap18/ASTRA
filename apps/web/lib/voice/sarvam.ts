import {
  clipFactCard,
  deterministicAskText,
  EVIDENCE_LIMIT_WARNING,
  evidenceIdsLimitExceeded,
} from "./facts.ts";
import { sanitizeUtterance } from "./sanitize.ts";

export const STT_MAX_BYTES = 2 * 1024 * 1024;
export const ASK_MAX_PAYLOAD_BYTES = 16 * 1024;
export type FetchLike = typeof fetch;

const SARVAM_BASE = "https://api.sarvam.ai";
const FETCH_TIMEOUT_MS = 20_000;
const UNAVAILABLE_WARNING = "Sarvam unavailable; returning the evidence summary.";
const BCP47_LANGUAGE = /^[a-z]{2,3}-[A-Z]{2}$/;

const TTS_LANGUAGES = new Set([
  "bn-IN",
  "en-IN",
  "gu-IN",
  "hi-IN",
  "kn-IN",
  "ml-IN",
  "mr-IN",
  "od-IN",
  "pa-IN",
  "ta-IN",
  "te-IN",
]);

type AskResult = {
  text: string;
  provider: string;
  language: string;
  ai_generated: boolean;
  warnings: string[];
  evidence_ids: string[];
};

function defaultFetch(): FetchLike {
  return fetch;
}

function sarvamKey(): string {
  const key = process.env.SARVAM_API_KEY;
  if (!key) {
    throw new Error("sarvam_unconfigured");
  }
  return key;
}

// sarvam-105b is a reasoning model: it spends thousands of tokens on hidden
// reasoning and returns empty content on small budgets. The conversations
// variant answers directly, which is what one spoken reply needs.
function sarvamModel(): string {
  return process.env.SARVAM_VOICE_MODEL || "sarvam-105b-conversations";
}

function fetchOptions(key: string, extra: RequestInit = {}): RequestInit {
  const headers = new Headers(extra.headers);
  headers.set("api-subscription-key", key);
  return {
    ...extra,
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers,
  };
}

export function normalizeProviderLanguage(language: string): string {
  return BCP47_LANGUAGE.test(language) ? language : "en-IN";
}

function askWarnings(card: unknown, baseWarnings: string[]): string[] {
  if (evidenceIdsLimitExceeded(card)) {
    return [...baseWarnings, EVIDENCE_LIMIT_WARNING];
  }
  return baseWarnings;
}

function resultEvidenceIds(card: unknown, clipped: ReturnType<typeof clipFactCard>): string[] {
  if (evidenceIdsLimitExceeded(card)) {
    return [];
  }
  return clipped.evidence_ids ?? [];
}

function deterministicResult(card: unknown, language: string): AskResult {
  const clipped = clipFactCard(card);
  const safeLanguage = normalizeProviderLanguage(language);
  return {
    text: deterministicAskText(clipped),
    provider: "deterministic",
    language: safeLanguage,
    ai_generated: false,
    warnings: askWarnings(card, [UNAVAILABLE_WARNING]),
    evidence_ids: resultEvidenceIds(card, clipped),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function missingSarvamKey(): boolean {
  return !process.env.SARVAM_API_KEY;
}

export function normalizeTtsLanguage(language: string): string {
  const safeLanguage = normalizeProviderLanguage(language);
  if (!TTS_LANGUAGES.has(safeLanguage)) {
    return "en-IN";
  }
  return safeLanguage;
}

export async function transcribeAudio(
  file: Blob,
  fetchImpl?: FetchLike,
): Promise<{ transcript: string; language: string }> {
  const key = sarvamKey();
  const fetchFn = fetchImpl ?? defaultFetch();
  const form = new FormData();
  form.append("file", file);
  form.append("model", "saaras:v3");
  form.append("language_code", "unknown");

  let response: Response;
  try {
    response = await fetchFn(
      `${SARVAM_BASE}/speech-to-text`,
      fetchOptions(key, { method: "POST", body: form }),
    );
  } catch {
    throw new Error("sarvam_request_failed");
  }

  if (!response.ok) {
    throw new Error("sarvam_request_failed");
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error("sarvam_request_failed");
  }

  if (!isRecord(data)) {
    throw new Error("sarvam_request_failed");
  }

  const transcript = readString(data.transcript);
  if (!transcript) {
    throw new Error("sarvam_request_failed");
  }

  const languageCode = readString(data.language_code);
  return {
    transcript,
    language: normalizeProviderLanguage(languageCode ?? "en-IN"),
  };
}

export async function synthesizeSpeech(
  text: string,
  language: string,
  fetchImpl?: FetchLike,
): Promise<Blob> {
  const key = sarvamKey();
  const fetchFn = fetchImpl ?? defaultFetch();

  let response: Response;
  try {
    response = await fetchFn(
      `${SARVAM_BASE}/text-to-speech`,
      fetchOptions(key, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.trim().slice(0, 500),
          language_code: normalizeTtsLanguage(language),
          model: "bulbul:v3",
          speaker: "shubh",
          output_audio_codec: "mp3",
        }),
      }),
    );
  } catch {
    throw new Error("sarvam_request_failed");
  }

  if (!response.ok) {
    throw new Error("sarvam_request_failed");
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error("sarvam_request_failed");
  }

  if (!isRecord(data) || !Array.isArray(data.audios)) {
    throw new Error("sarvam_request_failed");
  }

  const encoded = data.audios[0];
  if (typeof encoded !== "string" || !encoded) {
    throw new Error("sarvam_request_failed");
  }

  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length === 0) {
    throw new Error("sarvam_request_failed");
  }

  return new Blob([bytes], { type: "audio/mpeg" });
}

function buildAskPayload(card: unknown, utterance: string): Record<string, unknown> {
  const utteranceClean = sanitizeUtterance(utterance);
  const clipped = clipFactCard(card);
  return {
    ...clipFactCard({ ...clipped, utterance: utteranceClean }),
    utterance: utteranceClean,
  };
}

function stringifyAskPayload(payload: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(payload).sort()) {
    sorted[key] = payload[key];
  }
  return JSON.stringify(sorted);
}

export async function askSarvam(
  card: unknown,
  utterance: string,
  language: string,
  fetchImpl?: FetchLike,
): Promise<AskResult> {
  const clipped = clipFactCard(card);
  const safeLanguage = normalizeProviderLanguage(language);
  if (missingSarvamKey()) {
    return deterministicResult(card, safeLanguage);
  }

  const payload = buildAskPayload(card, utterance);
  const userContent = stringifyAskPayload(payload);
  if (Buffer.byteLength(userContent, "utf8") > ASK_MAX_PAYLOAD_BYTES) {
    return deterministicResult(card, safeLanguage);
  }

  const fetchFn = fetchImpl ?? defaultFetch();

  let response: Response;
  try {
    response = await fetchFn(
      `${SARVAM_BASE}/v1/chat/completions`,
      fetchOptions(sarvamKey(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: sarvamModel(),
          temperature: 0,
          max_tokens: 4000,
          messages: [
            {
              role: "system",
              content:
                "Explain only the supplied security evidence. Never invent a vulnerability, execution path, patch, or score. Distinguish unknown from safe. This is commentary on deterministic analysis. State the supplied numbers such as risk, trust, confidence, and counts when present. Answer in at most four short sentences suitable for speech. Reply in language " +
                safeLanguage,
            },
            { role: "user", content: userContent },
          ],
        }),
      }),
    );
  } catch {
    return deterministicResult(card, safeLanguage);
  }

  if (!response.ok) {
    return deterministicResult(card, safeLanguage);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return deterministicResult(card, safeLanguage);
  }

  if (!isRecord(data) || !Array.isArray(data.choices)) {
    return deterministicResult(card, safeLanguage);
  }

  const first = data.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) {
    return deterministicResult(card, safeLanguage);
  }

  const answer = readString(first.message.content);
  if (!answer?.trim()) {
    return deterministicResult(card, safeLanguage);
  }

  return {
    text: answer,
    provider: "sarvam",
    language: safeLanguage,
    ai_generated: true,
    warnings: askWarnings(card, []),
    evidence_ids: resultEvidenceIds(card, clipped),
  };
}

export type PlanResult = {
  steps: Array<{ action: string; package?: string; scan_id?: string; max_changes?: number }>;
  provider: string;
  ai_generated: boolean;
};

const PLAN_SYSTEM =
  'You turn one spoken operator request into a plan for a dependency-risk console. Reply with STRICT JSON only, no prose, no markdown: {"steps":[{"action":"list|open_scan|start_demo|simulate|simulate_riskiest|remediate|verify|ask","package":"name@version","scan_id":"as_...","max_changes":3}]}. "package" only for simulate and only from the supplied packages list; "scan_id" only for open_scan; "max_changes" only for remediate. Use simulate_riskiest for the most dangerous or riskiest package. Use start_demo for a demo scan. Use remediate when fixes, patches, or a remediation proposal are requested. Use ask when the request is a question. Never invent packages or ids.';

function parsePlanContent(content: string): PlanResult["steps"] {
  const text = content.replace(/```(?:json)?/gi, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!isRecord(data) || !Array.isArray(data.steps)) return [];
  return data.steps.filter(
    (s): s is PlanResult["steps"][number] => isRecord(s) && typeof s.action === "string",
  );
}

// Sarvam proposes steps only; every step is re-validated locally before the operator sees Run.
export async function planWithSarvam(
  card: unknown,
  utterance: string,
  packages: string[],
  fetchImpl?: FetchLike,
): Promise<PlanResult> {
  const none: PlanResult = { steps: [], provider: "deterministic", ai_generated: false };
  if (missingSarvamKey()) return none;
  const userContent = stringifyAskPayload({
    ...clipFactCard(card),
    utterance: sanitizeUtterance(utterance),
    packages: packages.filter((p) => typeof p === "string").slice(0, 100),
  });
  if (Buffer.byteLength(userContent, "utf8") > ASK_MAX_PAYLOAD_BYTES) return none;

  let data: unknown;
  try {
    const response = await (fetchImpl ?? defaultFetch())(
      `${SARVAM_BASE}/v1/chat/completions`,
      fetchOptions(sarvamKey(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: sarvamModel(),
          temperature: 0,
          max_tokens: 1000,
          messages: [
            { role: "system", content: PLAN_SYSTEM },
            { role: "user", content: userContent },
          ],
        }),
      }),
    );
    if (!response.ok) return none;
    data = await response.json();
  } catch {
    return none;
  }
  const first = isRecord(data) && Array.isArray(data.choices) ? data.choices[0] : undefined;
  const content = isRecord(first) && isRecord(first.message) ? readString(first.message.content) : undefined;
  const steps = content ? parsePlanContent(content) : [];
  return steps.length ? { steps, provider: "sarvam", ai_generated: true } : none;
}
