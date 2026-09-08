// Parses a --models entry: "[provider:]model[@effort][+web]".
//
// A backend, reasoning effort, and web access may travel with the model, so
// one batch can mix harnesses. The label (model name plus a +web marker) is
// the run's tag and the report's row: model names don't collide across
// backends, and a web-enabled run must not share a row with a sealed one,
// since lifting the sandbox changes what is being measured.
export function parseModelSpec(entry, defaultProvider) {
  const web = entry.endsWith('+web');
  const rest = web ? entry.slice(0, -'+web'.length) : entry;
  const [head, effort = null] = rest.split('@');
  const colon = head.indexOf(':');
  const provider = colon === -1 ? defaultProvider : head.slice(0, colon);
  const name = colon === -1 ? head : head.slice(colon + 1);
  return { provider, name, effort, web, label: `${name}${web ? '+web' : ''}` };
}

// A model spec as written on the command line, for the batch banner.
export function describeModelSpec({ provider, name, effort, web }) {
  return `${provider}:${name}${effort ? `@${effort}` : ''}${web ? '+web' : ''}`;
}
