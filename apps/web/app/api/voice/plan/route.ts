import { planWithSarvam } from "../../../../lib/voice/sarvam.ts";

export const runtime = "nodejs";
export const maxDuration = 60;

function fail(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  let body: { card?: unknown; utterance?: unknown; packages?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail(400, "invalid_request", "Expected JSON body");
  }
  if (typeof body?.utterance !== "string") {
    return fail(400, "invalid_request", "utterance must be a string");
  }
  const packages = Array.isArray(body.packages)
    ? body.packages.filter((p): p is string => typeof p === "string").slice(0, 100)
    : [];
  // planWithSarvam clips the card and sanitizes the utterance; missing key yields empty steps, never 5xx.
  const result = await planWithSarvam(body.card, body.utterance, packages);
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
