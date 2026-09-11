const CORE = process.env.ASTRA_CORE_URL ?? "http://127.0.0.1:8080";

export function coreHeaders(init?: HeadersInit) {
  const headers = new Headers();
  if (init) {
    new Headers(init).forEach((value, key) => {
      const lower = key.toLowerCase();
      if (lower === "content-type" || lower === "last-event-id" || lower === "authorization") {
        headers.set(key, value);
      }
    });
  }
  const token = process.env.ASTRA_API_TOKEN;
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

export async function proxyCore(request: Request, path: string) {
  const url = new URL(request.url);
  const target = `${CORE}/api/v1/${path}${url.search}`;
  const headers = coreHeaders(request.headers);
  const init: RequestInit = { method: request.method, headers, cache: "no-store" };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }
  const upstream = await fetch(target, init).catch(() => null);
  if (!upstream) {
    return Response.json(
      { error: { code: "core_unavailable", message: "Astra core is not reachable" } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const out = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) out.set("Content-Type", contentType);
  const requestId = upstream.headers.get("x-request-id");
  if (requestId) out.set("X-Request-ID", requestId);
  out.set("Cache-Control", "no-store");
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
