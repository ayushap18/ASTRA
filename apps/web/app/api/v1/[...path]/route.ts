import { proxyCore } from "@/lib/core";

export const maxDuration = 600;

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxyCore(request, path.join("/"));
}

export async function POST(request: Request, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxyCore(request, path.join("/"));
}
