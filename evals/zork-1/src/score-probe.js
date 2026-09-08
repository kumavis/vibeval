// Reads the game's own score and move counter by silently typing SCORE after
// each model turn. The model never sees this exchange — it is harness
// instrumentation, and SCORE does not advance Zork's move counter.
//
// The probe is not always answerable. Zork's Loud Room echoes every command
// back at the player ("score score ..."), so while the player stands there
// SCORE reports nothing. Freezing the move count on such a turn would also
// freeze the move budget, letting a run play far past its budget — which is
// what happened before this was tracked. Instead, an unanswered probe falls
// back to counting the commands played since the last answered one, and the
// count self-corrects as soon as the game answers again.
import { styleText } from 'node:util';

// Zork prints "in 1 move." but "in 2 moves." — both forms must parse, or the
// very first probe of every run is a silent miss.
const SCORE_LINE = /Your score is (-?\d+).*?in (\d+) moves?/s;

export function parseScoreProbe(text) {
  const match = typeof text === 'string' ? text.match(SCORE_LINE) : null;
  if (match === null) return null;
  return { score: Number(match[1]), moves: Number(match[2]) };
}

// Every command advances Zork's move counter except one the parser rejects
// outright, so this is the move count the game would have reported.
export function estimateUnprobedMoves(runStats) {
  const commands = runStats.commands - runStats.commandsAtLastProbe;
  const rejected = runStats.parserRejections - runStats.parserRejectionsAtLastProbe;
  return Math.max(0, commands - rejected);
}

export async function probeScore(zork, runStats, restarted, logEvent, toModelText) {
  if (restarted) return;
  const response = toModelText(await zork.input('SCORE'));
  const reading = parseScoreProbe(response);

  if (reading === null) {
    // Unanswered: carry the move count forward by estimate so the budget
    // still advances, and record that this run leaned on the estimate.
    runStats.scoreProbeFailures += 1;
    runStats.totalMoves =
      runStats.movesBeforeRestarts +
      (runStats.moves ?? 0) +
      estimateUnprobedMoves(runStats);
    if (runStats.scoreProbeFailures === 1) {
      logEvent('score_probe_unanswered', {
        commands: runStats.commands,
        response: response.slice(0, 200),
      });
    }
    return;
  }

  const { score, moves } = reading;
  if (score !== runStats.score) {
    console.log(styleText('cyan', `[score: ${score}, moves: ${moves}]`));
    runStats.maxScore = Math.max(runStats.maxScore ?? score, score);
    runStats.maxCommandsWithoutScore = Math.max(
      runStats.maxCommandsWithoutScore,
      runStats.commands - runStats.commandsAtLastScoreChange,
    );
    runStats.commandsAtLastScoreChange = runStats.commands;
    logEvent('score', { score, moves, commands: runStats.commands });
  }
  runStats.score = score;
  runStats.moves = moves;
  runStats.totalMoves = runStats.movesBeforeRestarts + moves;
  // The game answered, so the estimate's baseline moves up with it.
  runStats.commandsAtLastProbe = runStats.commands;
  runStats.parserRejectionsAtLastProbe = runStats.parserRejections;
}
