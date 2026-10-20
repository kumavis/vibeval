export function calculationGraph(submission, inference) {
  const nodes = submission.parameters.map(p => ({ id: p.atom, atom: p.atom, kind: 'parameter', operator: 'INPUT', probability: p.central, low: p.low, high: p.high, parameter: p }));
  const edges = [], byHead = new Map();
  submission.rules.forEach((rule, index) => { if (!byHead.has(rule.head)) byHead.set(rule.head, []); byHead.get(rule.head).push({ ...rule, index }); });
  for (const [head, rules] of byHead) {
    nodes.push({ id: head, atom: head, kind: head === 'p_doom' ? 'result' : 'derived',
      operator: rules.length > 1 ? 'OR' : rules[0].body.length > 1 ? 'AND' : 'PASS', probability: inference.queries[head], rules });
    for (const rule of rules) {
      if (rules.length > 1 && rule.body.length > 1) {
        const gate = `@rule:${rule.index}`;
        nodes.push({ id: gate, kind: 'gate', operator: 'AND', body: rule.body });
        rule.body.forEach(atom => edges.push({ from: atom, to: gate })); edges.push({ from: gate, to: head });
      } else rule.body.forEach(atom => edges.push({ from: atom, to: head }));
    }
  }
  const lookup = new Map(nodes.map(n => [n.id, n])), incoming = new Map(nodes.map(n => [n.id, []]));
  edges.forEach(e => incoming.get(e.to).push(e.from));
  const rank = id => { const node = lookup.get(id); if (node.rank !== undefined) return node.rank; node.rank = incoming.get(id).length ? 1 + Math.max(...incoming.get(id).map(rank)) : 0; return node.rank; };
  nodes.forEach(n => rank(n.id));
  const layers = [];
  nodes.forEach(n => { (layers[n.rank] ||= []).push(n); });
  const height = Math.max(...layers.map(layer => layer.length)) * 120 + 40;
  layers.forEach((layer, column) => {
    if (column > 0) layer.sort((a, b) => {
      const center = n => incoming.get(n.id).reduce((sum, id) => sum + lookup.get(id).y, 0) / incoming.get(n.id).length;
      return center(a) - center(b);
    });
    layer.forEach((n, i) => { n.x = column * 250 + 20; n.y = (height - layer.length * 120) / 2 + i * 120 + 8; n.width = 210; n.height = 100; });
  });
  return { nodes, edges, width: layers.length * 250, height };
}

export function formatPercent(value) {
  if (!Number.isFinite(value)) return '—';
  return `${new Intl.NumberFormat('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value * 100)}%`;
}

export function modelName(model) {
  const match = /^gpt-(\d+(?:\.\d+)?)-(luna|sol|astra)$/.exec(model);
  const claude = /^claude-(fable|opus|sonnet|haiku)-(\d+)-(\d+)$/.exec(model);
  if (claude) return `${claude[1][0].toUpperCase()}${claude[1].slice(1)} ${claude[2]}.${claude[3]}`;
  return match ? `${match[2][0].toUpperCase()}${match[2].slice(1)} ${match[1]}` : model;
}

export function formulaFor(node) {
  if (node.kind === 'parameter') return `${node.atom}: an independent Bernoulli switch; conditional meaning is defined by the model below.`;
  if (node.kind === 'gate') return node.body.join(' AND ');
  return node.rules.map(rule => `(${rule.body.join(' AND ')})`).join(' OR ');
}
