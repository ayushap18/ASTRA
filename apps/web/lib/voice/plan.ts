import {
  clampChanges,
  parseVoiceCommand,
  resolvePackage,
  type VoiceCommand,
  type VoiceContext,
  type VoicePackage,
} from "./commands.ts";
import {
  confirmRemediation,
  dispatchVoiceCommand,
  type VoiceDeps,
  type VoiceDispatchResult,
} from "./dispatch.ts";

export type PlanStep = {
  command: VoiceCommand;
  label: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  detail?: string;
};
export type VoicePlan = { steps: PlanStep[]; source: "local" | "sarvam"; needsConfirm: boolean };
export type RawPlanStep = { action: string; package?: string; scan_id?: string; max_changes?: number };

const ACTION_VERB = /scan|simulate|remediat|fix|open|verify|list|run|check/i;
const SPLIT =
  /\s*(?:,\s*and\s+then\b|\band\s+then\b|\bthen\b|\bafter\s+that\b|,\s*and\b|\band\b(?=\s+(?:simulate|attack|compromise|propose|remediat|fix|verify|open|list|start|scan|run|check)\b))\s*/i;
const NEEDS_SCAN = new Set(["simulate", "simulate_riskiest", "remediate"]);
const CONFIRM_TYPES = new Set(["remediate", "start_github", "start_demo", "simulate"]);
const POLL_MS = 1500;
const POLL_LIMIT_MS = 120_000;

export function splitUtterance(text: string): string[] {
  return text
    .split(SPLIT)
    .map((p) => p.trim().replace(/^[,.]+|[,.]+$/g, "").trim())
    .filter(Boolean);
}

function labelFor(c: VoiceCommand, packages: VoicePackage[]): string {
  switch (c.type) {
    case "list":
      return "List scans";
    case "open_scan":
      return `Open scan ${c.scanId}`;
    case "start_demo":
      return "Start demo scan";
    case "start_github":
      return `Start GitHub scan ${c.repository}`;
    case "handoff_allot":
      return "Open the scan form";
    case "simulate": {
      const p = packages.find((x) => x.id === c.packageId);
      return p ? `Simulate ${p.name}@${p.version} (${p.id})` : `Simulate ${c.packageId}`;
    }
    case "simulate_riskiest":
      return "Simulate the riskiest package (max risk score)";
    case "simulate_ambiguous":
      return "Simulate: package name is ambiguous";
    case "simulate_missing":
      return "Simulate: package not found";
    case "not_ready":
      return `${c.action}: scan not ready`;
    case "remediate":
      return `Propose remediation, max ${c.maxChanges} changes`;
    case "verify_handoff":
      return "Verify with the isolated build";
    case "refuse":
      return "Refused";
    case "ask":
      return "Answer question";
  }
}

function toStep(command: VoiceCommand, packages: VoicePackage[]): PlanStep {
  return { command, label: labelFor(command, packages), status: "pending" };
}

function finish(steps: PlanStep[], source: VoicePlan["source"]): VoicePlan {
  const refuse = steps.find((s) => s.command.type === "refuse");
  if (refuse) return { steps: [refuse], source, needsConfirm: false };
  return {
    steps,
    source,
    needsConfirm:
      source === "sarvam" || steps.length > 1 || steps.some((s) => CONFIRM_TYPES.has(s.command.type)),
  };
}

export function localPlan(transcript: string, ctx: VoiceContext): VoicePlan {
  let scanCtx = ctx;
  const steps = splitUtterance(transcript).map((part) => {
    const command = parseVoiceCommand(part, scanCtx);
    // A scan started or opened earlier in the plan is awaited at run time, so later steps parse as ready.
    if (command.type === "start_demo" || command.type === "open_scan") {
      scanCtx = { ...ctx, scanStatus: "completed" };
    }
    return toStep(command, ctx.packages);
  });
  return finish(steps.length ? steps : [toStep({ type: "ask" }, ctx.packages)], "local");
}

export function needsSarvamPlan(plan: VoicePlan, transcript: string): boolean {
  return plan.steps.every((s) => s.command.type === "ask") && ACTION_VERB.test(transcript);
}

function rawToCommand(raw: unknown, ctx: VoiceContext): VoiceCommand | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as RawPlanStep;
  switch (r.action) {
    case "list":
    case "start_demo":
    case "simulate_riskiest":
    case "ask":
      return { type: r.action };
    case "open_scan": {
      const found = ctx.scans.find((s) => s.id === r.scan_id);
      return found ? { type: "open_scan", scanId: found.id } : null;
    }
    case "simulate":
      if (typeof r.package !== "string" || !r.package) return { type: "simulate_missing" };
      return resolvePackage(r.package, ctx.packages) ?? { type: "simulate_missing" };
    case "remediate":
      return { type: "remediate", maxChanges: clampChanges(Number(r.max_changes) || 3) };
    case "verify":
      return { type: "verify_handoff" };
    default:
      return null;
  }
}

export function validatePlan(json: unknown, ctx: VoiceContext): VoicePlan {
  const raw = (json as { steps?: unknown })?.steps;
  const steps = (Array.isArray(raw) ? raw : [])
    .map((r) => rawToCommand(r, ctx))
    .filter((c): c is VoiceCommand => c !== null)
    .map((c) => toStep(c, ctx.packages));
  return { ...finish(steps, "sarvam"), needsConfirm: true };
}

async function waitReady(scanId: string, deps: VoiceDeps): Promise<boolean> {
  const until = Date.now() + POLL_LIMIT_MS;
  for (;;) {
    const scan = await deps.api<{ status?: string }>(`/api/v1/scans/${scanId}`);
    if (scan.status === "completed" || scan.status === "partial") return true;
    if (scan.status === "failed" || Date.now() > until) return false;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

export async function runPlan(
  plan: VoicePlan,
  deps: VoiceDeps & { say?: (text: string) => void },
  onUpdate: (plan: VoicePlan) => void,
): Promise<string> {
  const steps: PlanStep[] = plan.steps.map((s) => ({ ...s, status: "pending", detail: undefined }));
  const current = (): VoicePlan => ({ ...plan, steps: steps.map((s) => ({ ...s })) });
  let scanId = deps.scanId;
  const spoken: string[] = [];

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    step.status = "running";
    onUpdate(current());
    let out: VoiceDispatchResult;
    const scoped = { ...deps, scanId };
    if (NEEDS_SCAN.has(step.command.type) && scanId) {
      step.detail = "waiting for analysis";
      onUpdate(current());
      deps.say?.("Waiting for analysis.");
      const ready = await waitReady(scanId, deps).catch(() => false);
      if (!ready) {
        step.status = "failed";
        step.detail = "scan did not reach completed or partial";
        for (const later of steps.slice(i + 1)) later.status = "skipped";
        onUpdate(current());
        return `Step ${i + 1} failed: ${step.detail}`;
      }
    }
    if (step.command.type === "remediate") {
      // The operator's Run press is the confirmation for a planned proposal.
      out = await confirmRemediation(step.command.maxChanges, scoped);
    } else {
      out = await dispatchVoiceCommand(step.command, scoped);
    }
    const nextScan = out.navigateTo?.match(/^\/scans\/([^/]+)$/)?.[1];
    if (nextScan) scanId = nextScan;
    step.detail = out.speak || undefined;
    if (out.failed) {
      step.status = "failed";
      for (const later of steps.slice(i + 1)) later.status = "skipped";
      onUpdate(current());
      return `Step ${i + 1} failed: ${out.speak}`;
    }
    step.status = "done";
    if (out.speak) spoken.push(out.speak);
    onUpdate(current());
  }
  return [`${steps.length} of ${steps.length} steps done.`, ...spoken].join(" ");
}
