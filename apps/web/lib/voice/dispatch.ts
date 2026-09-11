import { remediationPayload, simulatePayload } from "../payloads.ts";
import type { VoiceCommand, VoicePackage } from "./commands.ts";

export type VoiceDeps = {
  api: <T>(path: string, init?: RequestInit) => Promise<T>;
  navigate: (href: string) => void;
  handoffVerify: () => void;
  scanId?: string;
};

export type VoiceDispatchResult = {
  speak: string;
  detail?: string;
  candidates?: VoicePackage[];
  pendingRemediation?: number;
  navigateTo?: string;
  ask?: true;
  failed?: true;
};

const NOT_READY = "Wait for a completed or partial scan first.";
const REFUSE_REASON: Record<string, string> = {
  exploit: "I do not produce exploits or proofs of concept.",
  safe_patch: "I cannot call a patch safe. Verified false means verified false.",
  source: "I do not read source files aloud.",
  secret: "That sounded like a credential. Do not speak secrets.",
};

function errorSpeech(err: unknown): string {
  const message = err instanceof Error ? err.message : "Request failed.";
  if (/queue_full|queue is full/i.test(message)) {
    return "Core said 429: queue is full, 18 admitted. Try again after a scan finishes.";
  }
  if (/409|not ready|conflict/i.test(message)) {
    return `Core said 409: ${message}. The scan must be completed or partial.`;
  }
  return `Core said: ${message}`;
}

export async function dispatchVoiceCommand(
  command: VoiceCommand,
  deps: VoiceDeps,
): Promise<VoiceDispatchResult> {
  try {
    switch (command.type) {
      case "list": {
        const body = await deps.api<{ scans?: { status: string }[] }>("/api/v1/scans");
        const scans = body.scans ?? [];
        const running = scans.filter((s) => s.status === "running").length;
        const queued = scans.filter((s) => s.status === "queued").length;
        return {
          speak: `${running} running, ${queued} queued, ${scans.length} total. Two workers, eighteen admitted.`,
        };
      }
      case "open_scan": {
        const href = `/scans/${command.scanId}`;
        deps.navigate(href);
        return { speak: `Opening scan ${command.scanId}.`, navigateTo: href };
      }
      case "start_demo": {
        const created = await deps.api<{ scan_id: string }>("/api/v1/scans", {
          method: "POST",
          body: JSON.stringify({ source: "demo" }),
        });
        const href = `/scans/${created.scan_id}`;
        deps.navigate(href);
        return { speak: `Demo scan ${created.scan_id} queued.`, navigateTo: href };
      }
      case "start_github": {
        try {
          const created = await deps.api<{ scan_id: string }>("/api/v1/scans", {
            method: "POST",
            body: JSON.stringify({ source: "github", repository: command.repository }),
          });
          const href = `/scans/${created.scan_id}`;
          deps.navigate(href);
          return { speak: `GitHub scan ${created.scan_id} queued.`, navigateTo: href };
        } catch (err) {
          const message = err instanceof Error ? err.message : "";
          if (/github.*disabled|disabled.*github|403|token|pat\b/i.test(message)) {
            deps.navigate("/#scan");
            return {
              speak: "GitHub scanning needs the form. Opening it.",
              detail: message,
              navigateTo: "/#scan",
            };
          }
          throw err;
        }
      }
      case "handoff_allot": {
        deps.navigate("/#scan");
        return {
          speak:
            command.reason === "zip"
              ? "ZIP and lockfile uploads use the scan form. Opening it."
              : "GitHub scans need a canonical repository URL. Opening the scan form.",
          navigateTo: "/#scan",
        };
      }
      case "simulate_riskiest": {
        if (!deps.scanId) return { speak: NOT_READY, failed: true };
        const graph = await deps.api<{ packages: (VoicePackage & { risk?: { score?: number } })[] }>(
          `/api/v1/scans/${deps.scanId}/graph`,
        );
        const scored = (graph.packages ?? []).filter((p) => typeof p.risk?.score === "number");
        if (scored.length === 0) return { speak: "No risk scores available.", failed: true };
        const top = scored.reduce((a, b) => ((b.risk?.score ?? 0) > (a.risk?.score ?? 0) ? b : a));
        const sim = await dispatchVoiceCommand({ type: "simulate", packageId: top.id }, deps);
        return { ...sim, speak: `Riskiest package is ${top.name}@${top.version}. ${sim.speak}` };
      }
      case "simulate": {
        if (!deps.scanId) return { speak: NOT_READY, failed: true };
        const sim = await deps.api<{ toxicity_radius: number }>(
          `/api/v1/scans/${deps.scanId}/simulate`,
          {
            method: "POST",
            body: JSON.stringify(
              simulatePayload({
                packageId: command.packageId,
                ciInstall: false,
                lifecycleScripts: false,
                categories: [],
              }),
            ),
          },
        );
        return {
          speak: `Simulation is hypothetical. Ancestry is not an execution path. Toxicity radius ${sim.toxicity_radius}.`,
          detail: `package ${command.packageId}`,
        };
      }
      case "simulate_ambiguous":
        return {
          speak: "That package name matches several instances. Pick an instance id.",
          candidates: command.candidates,
          failed: true,
        };
      case "simulate_missing":
        return { speak: "I could not find that package in this scan.", failed: true };
      case "not_ready":
        return { speak: NOT_READY, failed: true };
      case "remediate":
        return {
          speak: `Confirm to request a proposal of up to ${command.maxChanges} changes.`,
          pendingRemediation: command.maxChanges,
        };
      case "verify_handoff": {
        if (!deps.scanId) return { speak: "Open a scan first.", failed: true };
        const href = `/scans/${deps.scanId}/remediate`;
        deps.navigate(href);
        deps.handoffVerify();
        return { speak: "Pick the project ZIP to run the isolated build.", navigateTo: href };
      }
      case "refuse":
        return { speak: `I will not do that. ${REFUSE_REASON[command.reason]}` };
      case "ask":
        return { ask: true, speak: "" };
    }
  } catch (err) {
    return { speak: errorSpeech(err), failed: true };
  }
}

export async function confirmRemediation(
  maxChanges: number,
  deps: VoiceDeps,
): Promise<VoiceDispatchResult> {
  if (!deps.scanId) return { speak: NOT_READY, failed: true };
  try {
    const plan = await deps.api<{ status: string; verified: boolean }>(
      `/api/v1/scans/${deps.scanId}/remediation`,
      { method: "POST", body: JSON.stringify(remediationPayload(maxChanges)) },
    );
    return {
      speak: `Proposal returned. Status ${plan.status}, verified ${plan.verified}.`,
    };
  } catch (err) {
    return { speak: errorSpeech(err), failed: true };
  }
}
