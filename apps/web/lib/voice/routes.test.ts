import assert from "node:assert/strict";
import test from "node:test";
import { POST as askPost } from "../../app/api/voice/ask/route.ts";
import { POST as planPost } from "../../app/api/voice/plan/route.ts";
import { POST as sttPost } from "../../app/api/voice/stt/route.ts";
import { POST as ttsPost } from "../../app/api/voice/tts/route.ts";
import { STT_MAX_BYTES } from "./sarvam.ts";

async function withKey(key: string | undefined, run: () => Promise<void>): Promise<void> {
  const previous = process.env.SARVAM_API_KEY;
  if (key === undefined) {
    delete process.env.SARVAM_API_KEY;
  } else {
    process.env.SARVAM_API_KEY = key;
  }
  try {
    await run();
  } finally {
    if (previous === undefined) {
      delete process.env.SARVAM_API_KEY;
    } else {
      process.env.SARVAM_API_KEY = previous;
    }
  }
}

async function withFetch(fetchImpl: typeof fetch, run: () => Promise<void>): Promise<void> {
  const previous = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    await run();
  } finally {
    globalThis.fetch = previous;
  }
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("STT and TTS return 503 sarvam_unconfigured without a key", async () => {
  await withKey(undefined, async () => {
    const stt = await sttPost(
      new Request("http://localhost/api/voice/stt", { method: "POST", body: new Uint8Array(4) }),
    );
    assert.equal(stt.status, 503);
    assert.equal((await stt.json()).error.code, "sarvam_unconfigured");

    const tts = await ttsPost(jsonRequest("http://localhost/api/voice/tts", { text: "hello" }));
    assert.equal(tts.status, 503);
    assert.equal((await tts.json()).error.code, "sarvam_unconfigured");
  });
});

test("STT returns 413 for oversized audio without calling the provider", async () => {
  await withKey("test-provider-key", async () => {
    const neverFetch: typeof fetch = async () => {
      throw new Error("fetch must not be called");
    };
    await withFetch(neverFetch, async () => {
      const response = await sttPost(
        new Request("http://localhost/api/voice/stt", {
          method: "POST",
          headers: { "Content-Type": "audio/webm" },
          body: new Uint8Array(STT_MAX_BYTES + 1),
        }),
      );
      assert.equal(response.status, 413);
      assert.equal((await response.json()).error.code, "audio_too_large");
    });
  });
});

test("ASK strips lockfile and secrets before reaching the provider", async () => {
  await withKey("test-provider-key", async () => {
    let userContent = "";
    const captureFetch: typeof fetch = async (_input, init) => {
      const payload = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      userContent = payload.messages.find((m) => m.role === "user")?.content ?? "";
      return Response.json({ choices: [{ message: { content: "ok" } }] });
    };
    await withFetch(captureFetch, async () => {
      const response = await askPost(
        jsonRequest("http://localhost/api/voice/ask", {
          card: { summary: "one finding", lockfile: "package-lock.json contents" },
          utterance: "explain this Bearer abc123 and token ghp_xxxx",
        }),
      );
      assert.equal(response.status, 200);
      assert.equal((await response.json()).provider, "sarvam");
      assert.ok(userContent.length > 0);
      assert.ok(!userContent.includes("lockfile"));
      assert.ok(!userContent.includes("Bearer"));
      assert.ok(!userContent.includes("ghp_"));
    });
  });
});

test("ASK falls back to deterministic without a key", async () => {
  await withKey(undefined, async () => {
    const response = await askPost(
      jsonRequest("http://localhost/api/voice/ask", { card: { summary: "x" }, utterance: "hi" }),
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).provider, "deterministic");
  });
});

test("PLAN returns 200 with empty steps without a key", async () => {
  await withKey(undefined, async () => {
    const response = await planPost(
      jsonRequest("http://localhost/api/voice/plan", {
        card: { scan_id: "as_x", status: "completed" },
        utterance: "scan the demo project then simulate the riskiest package",
        packages: ["left-pad@1.3.0"],
      }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { steps: [], provider: "deterministic", ai_generated: false });
  });
});
