import { missingSarvamKey, STT_MAX_BYTES, transcribeAudio } from "../../../../lib/voice/sarvam.ts";

export const runtime = "nodejs";
export const maxDuration = 60;

function fail(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  if (missingSarvamKey()) {
    return fail(503, "sarvam_unconfigured", "Sarvam is not configured");
  }
  const buf = await request.arrayBuffer();
  if (buf.byteLength > STT_MAX_BYTES) {
    return fail(413, "audio_too_large", "Audio exceeds 2 MiB");
  }
  try {
    const { transcript, language } = await transcribeAudio(
      new Blob([buf], { type: request.headers.get("content-type") || "application/octet-stream" }),
    );
    return Response.json({ transcript, language }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return fail(502, "sarvam_unavailable", "Speech recognition failed");
  }
}
