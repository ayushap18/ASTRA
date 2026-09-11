import { missingSarvamKey, synthesizeSpeech } from "../../../../lib/voice/sarvam.ts";

export const runtime = "nodejs";
export const maxDuration = 60;

function fail(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  if (missingSarvamKey()) {
    return fail(503, "sarvam_unconfigured", "Sarvam is not configured");
  }
  let body: { text?: unknown; language?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail(400, "invalid_request", "Expected JSON body");
  }
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) {
    return fail(400, "invalid_request", "text is required");
  }
  const language = typeof body.language === "string" ? body.language : "en-IN";
  try {
    const audio = await synthesizeSpeech(text, language);
    return new Response(audio, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch {
    return fail(502, "sarvam_unavailable", "Speech synthesis failed");
  }
}
