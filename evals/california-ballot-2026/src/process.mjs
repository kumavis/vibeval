import { spawn } from 'node:child_process';

// No shell interpolation; stop descendants on interruption or deadline.
export function execute(command, args, { cwd, input = '', timeoutMs = 30000, signal, maxBytes = 40000000, onStdout, onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', size = 0, failure = null, killing = false;
    const kill = () => {
      if (killing) return; killing = true;
      const send = sig => { try { if (process.platform !== 'win32') process.kill(-child.pid, sig); else child.kill(sig); } catch {} };
      send('SIGTERM'); const timer = setTimeout(() => send('SIGKILL'), 1000); timer.unref();
    };
    const abort = () => { failure ??= Object.assign(new Error('Interrupted'), { code: 'INTERRUPTED' }); kill(); };
    const timer = setTimeout(() => { failure ??= Object.assign(new Error('Process deadline exceeded'), { code: 'TIMEOUT' }); kill(); }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const consume = (name, chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > maxBytes) { failure ??= new Error('Process output budget exceeded'); kill(); return; }
      if (name === 'stdout') stdout += chunk; else stderr += chunk;
      try { (name === 'stdout' ? onStdout : onStderr)?.(chunk); }
      catch (error) { failure ??= error; kill(); }
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', c => consume('stdout', c)); child.stderr.on('data', c => consume('stderr', c));
    child.stdin.on('error', () => {});
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    child.on('error', error => { cleanup(); error.stdout = stdout; error.stderr = stderr; reject(error); });
    child.on('close', code => {
      cleanup();
      if (failure) { failure.stdout = stdout; failure.stderr = stderr; reject(failure); }
      else resolve({ code, stdout, stderr });
    });
    child.stdin.end(input);
  });
}
