import { spawn } from 'node:child_process';

// Bounded process group, including compiler/CLI descendants; no shell interpolation.
export function execute(command, args, { cwd, input = '', timeoutMs = 30000, signal, maxBytes = 20000000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', size = 0, failure = null, killTimer;
    const kill = () => {
      const send = sig => { try { if (process.platform !== 'win32') process.kill(-child.pid, sig); else child.kill(sig); } catch { /* exited */ } };
      send('SIGTERM'); killTimer = setTimeout(() => send('SIGKILL'), 1000);
      killTimer.unref();
    };
    const abort = () => { failure = Object.assign(new Error('Interrupted'), { code: 'INTERRUPTED' }); kill(); };
    const timer = setTimeout(() => { failure = Object.assign(new Error('Process deadline exceeded'), { code: 'TIMEOUT' }); kill(); }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const consume = (name, chunk) => {
      size += chunk.length;
      if (size > maxBytes) { failure = new Error('Process output budget exceeded'); kill(); return; }
      if (name === 'stdout') stdout += chunk; else stderr += chunk;
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', c => consume('stdout', c)); child.stderr.on('data', c => consume('stderr', c));
    child.stdin.on('error', () => {});
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    child.on('error', error => { cleanup(); reject(error); });
    child.on('close', code => {
      cleanup();
      // Leave an already scheduled SIGKILL in place to reap lingering descendants.
      if (failure) { failure.stdout = stdout; failure.stderr = stderr; reject(failure); }
      else resolve({ code, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

export function parseEvents(stdout) {
  return stdout.split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
}
