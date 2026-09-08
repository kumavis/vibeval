import { mkdir, readFile, writeFile, readdir, lstat } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export function safeRelative(path) {
  if (typeof path !== 'string' || !path || path.length > 240 || path.split('/').some(p => !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(p))) throw new Error('Use a relative path with simple non-hidden names; no traversal');
  return path;
}

export async function fileInventory(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix + entry.name;
    safeRelative(path);
    if (entry.isSymbolicLink()) throw new Error('Symlinks are not allowed in artifacts');
    if (entry.isDirectory()) files.push(...await fileInventory(join(directory, entry.name), path + '/'));
    else if (entry.isFile()) files.push({ path, bytes: (await lstat(join(directory, entry.name))).size });
    else throw new Error('Only regular files are allowed');
  }
  return files.sort((a,b) => a.path.localeCompare(b.path));
}

export function createWorkspace(directory, limits) {
  async function location(path) {
    safeRelative(path);
    let current = directory;
    for (const part of path.split('/')) {
      current = join(current, part);
      try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Symlinks are not allowed'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return current;
  }
  return {
    list: () => fileInventory(directory),
    async read(path) { return readFile(await location(path), 'utf8'); },
    async write(path, content) {
      const destination = await location(path);
      if (typeof content !== 'string') throw new Error('File content must be text');
      const files = await fileInventory(directory);
      const bytes = Buffer.byteLength(content);
      if (files.filter(f => f.path !== path).reduce((n,f) => n + f.bytes, bytes) > limits.maxArtifactBytes) throw new Error('Artifact byte budget exceeded');
      if (!files.some(f => f.path === path) && files.length >= limits.maxFiles) throw new Error('Artifact file budget exceeded');
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, content);
      return { path, bytes };
    },
    async check() {
      const files = await fileInventory(directory);
      const errors = [];
      if (files.length > limits.maxFiles || files.reduce((n,f) => n + f.bytes, 0) > limits.maxArtifactBytes) errors.push('Artifact budget exceeded');
      if (!files.some(f => f.path === 'index.html')) errors.push('Missing index.html');
      else {
        const html = await readFile(join(directory, 'index.html'), 'utf8');
        if (!/<html[\s>]/i.test(html) || !/<\/html>/i.test(html)) errors.push('index.html must contain a complete HTML document');
      }
      // Validate static references in HTML and CSS. This is deliberately
      // packaging validation, not a claim to execute JavaScript or test UX.
      for (const file of files.filter(f => /\.(html|css)$/i.test(f.path))) {
        const text = await readFile(join(directory, file.path), 'utf8');
        const refs = [...text.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^\s)'";]+)["']?\s*\)/gi)].map(m => m[1] || m[2]);
        for (const ref of refs) {
          if (ref.startsWith('#') || ref.startsWith('data:')) continue;
          try {
            const base = new URL(file.path, 'https://artifact.invalid/');
            const target = new URL(ref, base);
            if (target.origin !== base.origin || ref.startsWith('/') || /^[a-z]+:/i.test(ref)) throw new Error('Use relative local asset URLs');
            const path = decodeURIComponent(target.pathname.slice(1));
            safeRelative(path);
            if (!files.some(f => f.path === path)) throw new Error('Missing local asset');
          } catch (error) { errors.push(`${file.path}: ${ref}: ${error.message}`); }
        }
      }
      return { valid: errors.length === 0, errors, files, checks: ['file budget', 'HTML entry', 'static HTML/CSS references'], notChecked: ['visual quality', 'JavaScript behavior', 'dynamic network requests'] };
    },
  };
}
