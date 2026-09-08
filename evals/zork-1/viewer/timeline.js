export function nearestCommand(commands, time) {
  if (!commands.length) return -1;
  let left = 0, right = commands.length - 1;
  while (left < right) {
    const middle = Math.floor((left + right) / 2);
    if (commands[middle].activeMs < time) left = middle + 1;
    else right = middle;
  }
  let index = left > 0 && time - commands[left - 1].activeMs < commands[left].activeMs - time ? left - 1 : left;
  // Batched commands can share a millisecond. Show the latest state there;
  // keyboard scrubbing still reaches every individual command.
  while (index + 1 < commands.length && commands[index + 1].activeMs === commands[index].activeMs) index++;
  return index;
}
export function stepPath(samples, x, y, endTime) {
  if (!samples.length) return '';
  let path = `M${x(samples[0].activeMs)},${y(samples[0].score)}`;
  for (const sample of samples.slice(1)) path += `H${x(sample.activeMs)}V${y(sample.score)}`;
  return path + `H${x(endTime)}`;
}
