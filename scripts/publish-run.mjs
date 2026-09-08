import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { publishRun } from '../packages/runner/src/publish.js';
const { values } = parseArgs({ options: { eval: { type: 'string' }, run: { type: 'string' } } });
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values.eval || '') || !values.run) throw new Error('Use --eval <id> --run <run-directory>');
const root = fileURLToPath(new URL('../', import.meta.url));
const record = await publishRun(join(root, 'evals', values.eval), resolve(values.run));
console.log(`Published ${record.id} (${record.status}) to ${values.eval}/data/public. Run npm run build to update the gallery.`);
