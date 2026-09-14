import { arch, cpus, platform, totalmem } from "node:os";
import type { MachineInfo } from "./outcome";

export function machineInfo(): MachineInfo {
  return {
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model.trim() || null,
    memGB: Math.round(totalmem() / 2 ** 30),
  };
}
