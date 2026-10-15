import { spawn } from 'node:child_process';

export function runBounded({ command, args, cwd, env, timeoutMs, termGraceMs = 5000, killGraceMs = 3000, redact = value => value }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let output = '', settled = false, timedOut = false, timer, killTimer, forceTimer;
    const append = chunk => { output = `${output}${chunk}`.slice(-8000); };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const stop = signal => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch { /* already exited */ }
    };
    const alive = () => {
      if (process.platform === 'win32' || !child.pid) return child.exitCode === null && child.signalCode === null;
      try { process.kill(-child.pid, 0); return true; } catch { return false; }
    };
    const detail = () => {
      const safe = redact(output.trim());
      return safe ? `; output=${safe}` : '';
    };
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); clearTimeout(killTimer); clearTimeout(forceTimer);
      error ? reject(error) : resolve();
    };
    timer = setTimeout(() => {
      timedOut = true;
      stop('SIGTERM');
      killTimer = setTimeout(() => {
        stop('SIGKILL');
        const deadline = Date.now() + killGraceMs;
        const awaitExit = () => {
          if (!alive()) return finish(new Error(`paid recovery process timed out after ${timeoutMs}ms${detail()}`));
          if (Date.now() >= deadline) {
            child.stdout.destroy(); child.stderr.destroy(); child.unref();
            return finish(new Error(`paid recovery process group survived SIGKILL${detail()}`));
          }
          forceTimer = setTimeout(awaitExit, 50);
        };
        awaitExit();
      }, termGraceMs);
    }, timeoutMs);
    child.once('error', error => finish(new Error(`paid recovery process failed to start: ${redact(String(error?.message ?? error))}`)));
    child.once('exit', (code, signal) => {
      if (timedOut) return;
      finish(code === 0 ? undefined : new Error(`paid recovery process failed (exit=${code ?? 'null'}, signal=${signal ?? 'none'})${detail()}`));
    });
  });
}
