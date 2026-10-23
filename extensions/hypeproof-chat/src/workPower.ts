import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";

/** REQ-STUDIO-WORK-POWER: idle system sleep only; never inhibit display sleep. */
export type PowerWork = "coach-turn" | "preview-build" | "update-download";
export type PowerProcess = Pick<ChildProcess, "kill" | "once" | "stdin">;

// Run the assertion and the blocking read on one native thread. EOF also releases
// it when the extension host crashes; no user input is interpolated into this code.
export const WINDOWS_POWER_SCRIPT = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class StudioWorkPower {
  [DllImport("kernel32.dll")] static extern uint SetThreadExecutionState(uint flags);
  public static void Hold() {
    if (SetThreadExecutionState(0x80000001) == 0) throw new Exception("Power assertion failed");
    try { Console.In.ReadToEnd(); }
    finally { SetThreadExecutionState(0x80000000); }
  }
}
'@
[StudioWorkPower]::Hold();
`;

export function nativePowerCommand(platform: NodeJS.Platform, pid: number): { file: string; args: string[] } | undefined {
  if (platform === "darwin") return { file: "/usr/bin/caffeinate", args: ["-i", "-w", String(pid)] };
  if (platform === "win32") return {
    file: join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_POWER_SCRIPT],
  };
  return undefined;
}

export function startNativePower(): PowerProcess | undefined {
  const command = nativePowerCommand(process.platform, process.pid);
  if (!command) return undefined;
  return spawn(command.file, command.args, { windowsHide: true, stdio: ["pipe", "ignore", "ignore"] });
}

/** One helper per host; windows/hosts have independent OS assertions. */
export class WorkPower {
  private leases = new Set<symbol>();
  private child: PowerProcess | undefined;
  private disposed = false;
  private start: () => PowerProcess | undefined;
  private warn: () => void;
  constructor(start: () => PowerProcess | undefined = startNativePower,
    warn: () => void = () => console.warn("[work-power] System sleep prevention unavailable")) {
    this.start = start; this.warn = warn;
  }

  acquire(work: PowerWork): () => void {
    if (this.disposed) return () => {};
    const lease = Symbol(work);
    this.leases.add(lease);
    if (!this.child) {
      try {
        const child = this.start();
        this.child = child;
        if (child) {
          child.once("error", () => { if (this.child === child) this.child = undefined; this.warn(); });
          child.once("exit", () => { if (this.child === child) this.child = undefined; });
        }
      } catch { this.warn(); }
    }
    return () => {
      this.leases.delete(lease);
      if (this.leases.size === 0) this.stop();
    };
  }

  private stop(): void {
    const child = this.child;
    this.child = undefined;
    // Termination releases OS-owned assertions even if the helper is still starting.
    child?.kill();
  }

  dispose(): void {
    this.disposed = true;
    this.leases.clear();
    this.stop();
  }
}

export const workPower = new WorkPower();
