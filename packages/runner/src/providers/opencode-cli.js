// OpenCode CLI as a text oracle, using whatever provider login the CLI
// already has. Like `codex exec`, `opencode run` has no persistent stdin
// protocol, so one process is spawned per turn and the conversation is
// carried by the session id it reports on every JSON event: the first turn
// opens a session, later turns pass `--session <id>` and the server replays
// its stored history. Boot is therefore paid per turn (~1s), which costs
// wall time but not move budget — runs are bounded by game moves, not the
// clock.
//
// Sandbox: a fresh empty working directory per game, a custom primary agent
// defined inline through OPENCODE_CONFIG_CONTENT whose prompt is the player
// prompt and whose `*` permission denies every tool (built-in, custom, or
// MCP), `--pure` (no external plugins), and snapshot/share/autoupdate
// disabled. Unlike the Codex backend the agent prompt replaces the host's
// own agent instructions rather than riding on top of them, and reading
// CLAUDE.md-style files is disabled too.
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import {
  TEXT_PROTOCOL_APPENDIX,
  parseTextTurn,
  withTranscript,
} from './text-protocol.js';

// Large artifact generations can exceed five minutes at high reasoning effort.
// The eval's wall-clock budget still bounds every turn; this only decides when
// a single request is declared stuck. OpenCode's own 32k completion cap is
// left in place: on a hit, it auto-continues the step, which keeps very long
// reasoning from turning into one unbounded turn.
const TURN_TIMEOUT_MS = 15 * 60 * 1000;
const AGENT_NAME = 'vibeval';

export function createOpenCodeCliProvider({ systemPrompt, responseFormat = 'commands', model: requestedModel, effort: requestedEffort, turnTimeoutMs = TURN_TIMEOUT_MS, deadline = Infinity, retryOnFailure = true }) {
  const model = requestedModel ?? process.env.OPENCODE_CLI_MODEL;
  const effort = requestedEffort ?? process.env.OPENCODE_CLI_EFFORT;
  const instructions =
    systemPrompt + (responseFormat === 'commands' ? TEXT_PROTOCOL_APPENDIX : '');
  const history = [];
  let disposed = false;

  // Inline config has the highest non-managed precedence, so a user or
  // project config cannot re-enable tools or add MCP servers under us. The
  // permission key is a wildcard pattern over tool names, so one `*` denial
  // covers built-ins, custom tools, and MCP tools alike.
  const configContent = JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    autoupdate: false,
    snapshot: false,
    share: 'disabled',
    formatter: false,
    lsp: false,
    default_agent: AGENT_NAME,
    agent: {
      [AGENT_NAME]: {
        description: 'Vibeval text oracle',
        mode: 'primary',
        prompt: instructions,
        permission: { '*': 'deny' },
      },
    },
  });

  // Cumulative usage from step-finish events. OpenCode prices tokens locally
  // from models.dev list rates, so a positive cost is API-equivalent, not a
  // subscription charge. Zero means the model had no rate metadata rather
  // than that the run was free, so it is reported only once something is
  // actually priced.
  const usage = {
    turns: 0,
    requests: 0,
    retries: 0,
    costReported: false,
    assistantMessages: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    thinkingTokens: 0,
    costUsd: 0,
    apiMs: 0,
  };

  // The session the game is being played in; null until the first turn opens
  // one, and reset to null when a session is lost so the next turn starts a
  // fresh one from the shadow transcript.
  let sessionId = null;
  let workspace = null;
  const children = new Set();

  const killChild = (proc) => {
    if (!proc) return;
    proc.kill();
    setTimeout(() => proc.kill('SIGKILL'), 5000).unref();
  };

  // One `opencode run` invocation: writes the prompt on stdin, reads the
  // JSONL event stream, and resolves with the agent's final text.
  const runTurn = (prompt) =>
    new Promise((resolve, reject) => {
      const args = [
        'run',
        '--format',
        'json',
        '--pure',
        '--dir',
        workspace,
        '--agent',
        AGENT_NAME,
        ...(sessionId ? ['--session', sessionId] : []),
        ...(model ? ['--model', model] : []),
        ...(effort ? ['--variant', effort] : []),
      ];
      const child = spawn('opencode', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: workspace,
        env: {
          ...process.env,
          OPENCODE_CONFIG_CONTENT: configContent,
          OPENCODE_DISABLE_AUTOUPDATE: '1',
          OPENCODE_DISABLE_CLAUDE_CODE: '1',
        },
      });
      children.add(child);

      let stderr = '';
      let text = null;
      let failure = null;
      // A step-finish part can be broadcast more than once; count each once.
      const countedSteps = new Set();
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.stdin.on('error', () => {});

      const finish = (outcome, value) => {
        if (timer === null) return;
        clearTimeout(timer);
        timer = null;
        children.delete(child);
        (outcome === 'resolve' ? resolve : reject)(value);
      };
      let timer = setTimeout(() => {
        finish('reject', Object.assign(new Error('opencode CLI turn timed out'), { code: 'REQUEST_TIMEOUT' }));
        killChild(child);
      }, Math.max(1, Math.min(turnTimeoutMs, deadline - Date.now())));

      const rl = createInterface({ input: child.stdout });
      rl.on('line', (line) => {
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        if (event.sessionID) sessionId = event.sessionID;
        switch (event.type) {
          case 'text':
            // Only completed parts are emitted, so the last one of the turn
            // is the model's answer; partial deltas never reach this stream.
            text = event.part?.text ?? text;
            break;
          case 'step_finish': {
            const part = event.part;
            if (!part?.id || countedSteps.has(part.id)) break;
            countedSteps.add(part.id);
            usage.turns += 1;
            usage.assistantMessages += 1;
            const tokens = part.tokens ?? {};
            usage.inputTokens += tokens.input ?? 0;
            usage.outputTokens += tokens.output ?? 0;
            usage.cacheReadTokens += tokens.cache?.read ?? 0;
            usage.cacheWriteTokens += tokens.cache?.write ?? 0;
            usage.thinkingTokens += tokens.reasoning ?? 0;
            if (Number.isFinite(part.cost) && part.cost > 0) {
              usage.costReported = true;
              usage.costUsd += part.cost;
            }
            break;
          }
          case 'error':
            failure =
              event.error?.data?.message ?? event.error?.name ?? 'opencode error';
            break;
          default:
            break;
        }
      });

      child.on('error', (err) => finish('reject', err));
      child.on('exit', (code) => {
        if (failure !== null) {
          finish('reject', new Error(`opencode CLI: ${failure}`));
        } else if (text === null) {
          finish(
            'reject',
            new Error(
              `opencode CLI produced no message (exit ${code})${stderr ? `: ${stderr.trim().slice(0, 500)}` : ''}`,
            ),
          );
        } else {
          finish('resolve', text);
        }
      });

      child.stdin.end(prompt || '(no output)');
    });

  return {
    name: 'opencode-cli',
    model: model ?? '(opencode CLI default)',
    history: () => history,
    // Seeds the transcript when the harness resumes an interrupted run. There
    // is no live session, so the next turn replays the whole transcript.
    restoreHistory(entries) {
      history.push(...entries);
    },

    // No resolvedModel: the `run --format json` stream does not name the
    // model that served each step, and the requested id is provider-qualified
    // already, so the report labels the row with what was requested.
    stats: () => ({ ...usage }),

    // gameOutputs pair 1:1 with the commands returned by the previous call.
    async requestCommands(gameOutputs) {
      return parseTextTurn(await this.requestText(gameOutputs));
    },

    // Raw responses support single-file art, games, and simulations.
    async requestText(gameOutputs) {
      if (disposed) throw new Error('Provider disposed');
      usage.requests += 1;
      if (workspace === null) {
        // An empty directory of its own: nothing to read, nothing to keep
        // between turns.
        workspace = await mkdtemp(join(tmpdir(), 'vibeval-opencode-'));
      }
      const prompt =
        gameOutputs.join('\n') ||
        (responseFormat === 'commands' ? 'Please submit your next command with a COMMAND: line.' : 'Please respond.');

      // No session yet but a transcript exists (resumed run, or a lost
      // session): open a fresh session with the whole transcript replayed.
      const needsReplay = sessionId === null && history.length > 0;
      let raw;
      try {
        raw = await runTurn(needsReplay ? withTranscript(history, prompt) : prompt);
      } catch (err) {
        if (!retryOnFailure || disposed || err.code === 'REQUEST_TIMEOUT' || deadline - Date.now() < 60000) throw err;
        usage.retries += 1;
        console.warn(`opencode CLI turn failed (${err.message}), restarting session.`);
        sessionId = null;
        raw = await runTurn(withTranscript(history, prompt));
      }

      // Commit only after a successful exchange, so a retried request
      // rebuilds the same transcript instead of double-appending.
      history.push(
        { role: 'user', content: prompt },
        { role: 'assistant', content: raw },
      );
      return raw;
    },

    dispose() {
      disposed = true;
      for (const proc of children) killChild(proc);
      children.clear();
    },
  };
}
