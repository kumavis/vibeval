import { cp, mkdir, readdir, readFile, rm, writeFile, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export async function readCatalog(base = root) {
  const catalog = [];
  for (const entry of (await readdir(join(base, 'evals'), { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const directory = join(base, 'evals', entry.name);
    const manifest = JSON.parse(await readFile(join(directory, 'eval.json'), 'utf8'));
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.id) || manifest.id !== entry.name) throw new Error(`Invalid eval id: ${entry.name}`);
    for (const key of ['title', 'description', 'kind']) if (typeof manifest[key] !== 'string' || !manifest[key].trim()) throw new Error(`${entry.name}: missing ${key}`);
    if (!['interactive', 'static-artifacts'].includes(manifest.kind)) throw new Error(`${entry.name}: unknown kind`);
    await lstat(join(directory, 'viewer/index.html'));
    catalog.push({ ...manifest, url: `evals/${manifest.id}/` });
  }
  return catalog;
}

// Copy only deliberate public surfaces. No runners, raw logs, or credentials.
async function copyPublic(source, target) {
  const stat = await lstat(source);
  if (stat.isSymbolicLink()) throw new Error(`Public assets cannot be symlinks: ${source}`);
  if (stat.isDirectory()) {
    await mkdir(target, { recursive: true });
    for (const name of await readdir(source)) {
      if (name.startsWith('.')) throw new Error(`Hidden file in public assets: ${source}/${name}`);
      await copyPublic(join(source, name), join(target, name));
    }
  } else await cp(source, target);
}

export async function build(base = root) {
  const catalog = await readCatalog(base);
  const out = join(base, 'dist');
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await copyPublic(join(base, 'apps/gallery'), out);
  await mkdir(join(out, 'shared'), { recursive: true });
  await copyPublic(join(base, 'packages/viewer'), join(out, 'shared'));
  for (const item of catalog) {
    const source = join(base, 'evals', item.id);
    const dest = join(out, 'evals', item.id);
    await copyPublic(join(source, 'viewer'), dest);
    await copyPublic(join(source, 'data/public'), join(dest, 'data'));
    await writeFile(join(dest, 'eval.json'), JSON.stringify(item, null, 2));
  }
  await writeFile(join(out, 'catalog.json'), JSON.stringify(catalog, null, 2));
  await writeFile(join(out, '.nojekyll'), '');
  return catalog;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const catalog = await build();
  console.log(`Built ${catalog.length} eval(s) into dist/`);
}
