// Codex CLI as a text oracle, using whatever ChatGPT login the CLI already
// has. Unlike the Claude CLI, `codex exec` has no persistent stdin protocol,
// so one process is spawned per turn and the conversation is carried by
// `codex exec resume <thread-id>`: the CLI reloads the thread, appends the
// new game output, and the Responses API prompt cache covers the replayed
// prefix. Boot is therefore paid per turn (~2s), which costs wall time but
// not move budget — runs are bounded by game moves, not the clock.
//
// Sandbox: a fresh empty working directory per game, `--ignore-user-config`
// (no plugins, skills, or MCP servers), `--ignore-rules`, a read-only
// sandbox, and no web search, so the model's only effector is the game.
// Codex's own agent instructions cannot be replaced the way `claude
// --system-prompt` replaces Claude Code's, so the player prompt is injected
// as `developer_instructions` and rides on top of them.
//
// CODEX_CLI_WEB_SEARCH=true lifts the web-search half of that sandbox, which
// lets the model look up a Zork walkthrough mid-game. That is a different
// experiment, not a better-configured run of the same one, so the provider
// reports its model as `<model>+web` and its runs land in their own report
// row rather than pooling with the sealed ones.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import {
  TEXT_PROTOCOL_APPENDIX,
  parseTextTurn,
  withTranscript,
} from './text-protocol.js';

const TURN_TIMEOUT_MS = 5 * 60 * 1000;

// Only added when web search is unsealed. The sealed prompt stays byte-for-byte
// what produced the existing sealed results, and a model that is never told it
// can search would otherwise most likely never try — which would measure
// discovery rather than the value of the access itself.
const WEB_SEARCH_APPENDIX = `
# Tools
- You have web search available. Use it if you think it will help.
`;

export function createCodexCliProvider({ systemPrompt, responseFormat = 'commands', model: requestedModel, effort: requestedEffort, webSearch: requestedWebSearch, turnTimeoutMs = TURN_TIMEOUT_MS, outputSchema, deadline = Infinity, retryOnFailure = true }) {
  const model = requestedModel ?? process.env.CODEX_CLI_MODEL;
  const effort = requestedEffort ?? process.env.CODEX_CLI_EFFORT;
  const webSearch = requestedWebSearch ?? (process.env.CODEX_CLI_WEB_SEARCH === 'true');
  const instructions =
    systemPrompt +
    (webSearch ? WEB_SEARCH_APPENDIX : '') +
    (responseFormat === 'commands' ? TEXT_PROTOCOL_APPENDIX : '');
  const history = [];
  let disposed = false;

  // Cumulative usage from turn.completed events. Codex reports tokens only —
  // a ChatGPT-subscription run has no per-call price — so costUsd stays null
  // and the report shows cost as unavailable rather than as $0.
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
    costUsd: null,
    apiMs: 0,
  };

  // The thread the game is being played in; null until the first turn opens
  // one, and reset to null when a thread is lost so the next turn starts a
  // fresh one from the shadow transcript.
  let threadId = null;
  let workspace = null;
  let schemaPath = null;
  const children = new Set();

  const killChild = (proc) => {
    if (!proc) return;
    proc.kill();
    setTimeout(() => proc.kill('SIGKILL'), 5000).unref();
  };

  // TOML basic-string encoding for -c overrides. JSON's escapes (\n, \", \\,
  // \uXXXX) are all valid TOML, so JSON.stringify is a correct encoder here;
  // without it a multi-line prompt would fall back to Codex's raw-literal
  // path and any TOML-looking prefix could be misparsed.
  const config = (key, value) => ['-c', `${key}=${JSON.stringify(value)}`];

  const commonArgs = () => [
    '--json',
    ...(schemaPath ? ['--output-schema', schemaPath] : []),
    '--skip-git-repo-check',
    '--ignore-user-config',
    '--ignore-rules',
    ...config('sandbox_mode', 'read-only'),
    '-c',
    `tools.web_search=${webSearch}`,
    ...config('developer_instructions', instructions),
    ...(effort ? config('model_reasoning_effort', effort) : []),
    ...(model ? ['-m', model] : []),
  ];

  // One `codex exec` invocation: writes the prompt on stdin, reads the JSONL
  // event stream, and resolves with the agent's final message.
  const runTurn = (prompt) =>
    new Promise((resolve, reject) => {
      const args = threadId
        ? ['exec', 'resume', threadId, ...commonArgs(), '-']
        : ['exec', ...commonArgs(), '-C', workspace, '-'];
      const child = spawn('codex', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: workspace,
      });
      children.add(child);

      let stderr = '';
      let message = null;
      let failure = null;
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
        finish('reject', Object.assign(new Error('codex CLI turn timed out'), { code: 'REQUEST_TIMEOUT' }));
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
        switch (event.type) {
          case 'thread.started':
            // A resumed thread reports the same id; a fresh one adopts it.
            threadId = event.thread_id ?? threadId;
            break;
          case 'item.completed':
            // The last agent_message of the turn is the model's answer;
            // reasoning and command_execution items are ignored.
            if (event.item?.type === 'agent_message') {
              message = event.item.text ?? '';
            }
            break;
          case 'turn.completed': {
            const u = event.usage ?? {};
            usage.turns += 1;
            usage.inputTokens += u.input_tokens ?? 0;
            usage.outputTokens += u.output_tokens ?? 0;
            usage.cacheReadTokens += u.cached_input_tokens ?? 0;
            usage.cacheWriteTokens += u.cache_write_input_tokens ?? 0;
            usage.thinkingTokens += u.reasoning_output_tokens ?? 0;
            break;
          }
          case 'turn.failed':
            failure = event.error?.message ?? 'turn failed';
            break;
          case 'error':
            failure = event.message ?? 'codex error';
            break;
          default:
            break;
        }
      });

      child.on('error', (err) => finish('reject', err));
      child.on('exit', (code) => {
        if (failure !== null) {
          finish('reject', new Error(`codex CLI: ${failure}`));
        } else if (message === null) {
          finish(
            'reject',
            new Error(
              `codex CLI produced no message (exit ${code})${stderr ? `: ${stderr.trim().slice(0, 500)}` : ''}`,
            ),
          );
        } else {
          finish('resolve', message);
        }
      });

      child.stdin.end(prompt || '(no output)');
    });

  return {
    name: 'codex-cli',
    // The +web suffix travels into run_start, so the report never averages a
    // walkthrough-assisted run together with a sealed one.
    model: `${model ?? '(codex CLI default)'}${webSearch ? '+web' : ''}`,
    history: () => history,
    // Seeds the transcript when the harness resumes an interrupted run. There
    // is no live thread, so the next turn replays the whole transcript.
    restoreHistory(entries) {
      history.push(...entries);
    },

    // No resolvedModel: Codex's event stream never names the model it
    // served, and CODEX_CLI_MODEL is already an exact id rather than a
    // moving alias, so the report labels the row with what was requested
    // instead of claiming a resolution that was never observed.
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
        workspace = await mkdtemp(join(tmpdir(), 'zork-codex-'));
        if (outputSchema) { schemaPath = join(workspace, 'response-schema.json'); await writeFile(schemaPath, JSON.stringify(outputSchema)); }
      }
      const prompt =
        gameOutputs.join('\n') ||
        (responseFormat === 'commands' ? 'Please submit your next command with a COMMAND: line.' : 'Please respond.');

      // No thread yet but a transcript exists (resumed run, or a lost
      // thread): open a fresh thread with the whole transcript replayed.
      const needsReplay = threadId === null && history.length > 0;
      let raw;
      try {
        raw = await runTurn(needsReplay ? withTranscript(history, prompt) : prompt);
      } catch (err) {
        if (!retryOnFailure || disposed || err.code === 'REQUEST_TIMEOUT' || deadline - Date.now() < 60000) throw err;
        usage.retries += 1;
        console.warn(`codex CLI turn failed (${err.message}), restarting thread.`);
        threadId = null;
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
