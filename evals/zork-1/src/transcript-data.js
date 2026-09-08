// Preserve chronological command order. Score probes are observations, not
// interpolated game state. Pause gaps between resumed attempts are excluded.
export function transcriptData(events) {
  const commands = [], samples = [];
  let commentary = '', score = null, scoreCommand = null;
  let attemptStart = null, previousTime = null, accumulated = 0, activeMs = 0;
  for (const event of events) {
    if (event.type === 'run_start' || event.type === 'run_resume') {
      if (attemptStart != null && previousTime != null) accumulated += Math.max(0, previousTime - attemptStart);
      attemptStart = Number.isFinite(event.t) ? event.t : previousTime;
    }
    if (Number.isFinite(event.t)) {
      attemptStart ??= event.t;
      previousTime = event.t;
      activeMs = Math.max(activeMs, accumulated + Math.max(0, event.t - attemptStart));
    }
    if (event.type === 'model_turn') commentary = event.commentary || '';
    if (event.type === 'command') commands.push({ command: event.command, response: event.response, commentary, turn: event.turn,
      activeMs, score, scoreCommand, scoreObserved: false, parserRejection: Boolean(event.parserRejection), worldRefusal: Boolean(event.worldRefusal) });
    if (event.type === 'score' && Number.isFinite(event.score)) {
      score = event.score;
      scoreCommand = commands.length;
      if (commands.length) {
        const command = commands.at(-1);
        Object.assign(command, { score, scoreCommand, scoreObserved: true, moves: event.moves ?? null });
        samples.push({ command: commands.length, activeMs: command.activeMs, score });
      }
    }
  }
  return { commands, samples, durationMs: commands.at(-1)?.activeMs ?? 0 };
}
