import { askSarvam } from "../../../../lib/voice/sarvam.ts";

export const runtime = "nodejs";
export const maxDuration = 60;

function fail(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  let body: { card?: unknown; utterance?: unknown; language?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail(400, "invalid_request", "Expected JSON body");
  }
  if (typeof body?.utterance !== "string") {
    return fail(400, "invalid_request", "utterance must be a string");
  }
  const language = typeof body.language === "string" ? body.language : "en-IN";
  // askSarvam clips the card and sanitizes the utterance server-side.
  const result = await askSarvam(body.card, body.utterance, language);
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
