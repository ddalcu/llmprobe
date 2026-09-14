export interface Machine {
  platform?: string;
  arch?: string;
  cpu?: string | null;
  memGB?: number;
}

export interface RunSummary {
  key: string;
  model: string;
  engine: string | null;
  hardware: string;
  label: string | null;
  startedAt: string | null;
  coverage: number | null;
  conformance: number | null;
  capability: number | null;
  verdict: string | null;
  decodeTokPerSec: number | null;
  prefillTokPerSec: number | null;
  ttftMs: number | null;
}

export const UNKNOWN_HARDWARE = "unknown";

/** Must stay in lockstep with HARDWARE_SQL — the UI filters on this string. */
export function hardwareLabel(machine: Machine | undefined | null): string {
  const parts = [
    machine?.cpu,
    machine?.memGB != null ? `${machine.memGB}GB` : null,
    machine?.platform && machine?.arch
      ? `${machine.platform}/${machine.arch}`
      : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : UNKNOWN_HARDWARE;
}

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

export function summarize(key: string, data: any): RunSummary {
  return {
    key,
    model: data?.target?.model ?? "unknown",
    engine: data?.target?.engine ?? null,
    hardware: hardwareLabel(data?.machine),
    label: data?.run?.label ?? null,
    startedAt: data?.run?.startedAt ?? null,
    coverage: num(
      (data?.coverage?.byTier as any[] | undefined)?.find(
        (t) => t?.tier === "core",
      )?.pct,
    ),
    conformance: num(data?.conformance?.pct),
    capability: num(data?.capability?.pct),
    verdict: data?.capability?.verdict ?? null,
    decodeTokPerSec: num(data?.bench?.decodeTokPerSec?.median),
    prefillTokPerSec: num(data?.bench?.prefillTokPerSec?.median),
    ttftMs: num(data?.bench?.ttftMs?.median),
  };
}
