export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.filter(x => x != null).map(x => typeof x === 'string' ? document.createTextNode(x) : x));
  return node;
}
export async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`);
  return response.json();
}
export function fail(node, error) { node.replaceChildren(el('p', { class: 'error', role: 'alert' }, error.message)); }
