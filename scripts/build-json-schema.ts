/**
 * Writes `schema/xray.schema.json` (every supported tag) and
 * `schema/<tag>.schema.json` (one per tag in src/core-keys.json).
 *
 *   bun run schema:build           regenerate
 *   bun run schema:build --check   fail if regenerating would change a file (CI)
 *
 * The output is committed: it is text, and a raw GitHub or jsDelivr URL to it
 * is what people put in `$schema`.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { fixture } from '../src/walk.js';
import { keyDocs } from './descriptions.js';
import { buildJsonSchema } from './json-schema.js';
import { ROOT } from './tags.js';

const check = process.argv.includes('--check');
const OUT = join(ROOT, 'schema');

const docs = await keyDocs();
const files: Record<string, string> = {
    'xray.schema.json': JSON.stringify(buildJsonSchema({ docs }), null, 2) + '\n',
};
for (const tag of fixture.tags) {
    files[`${tag}.schema.json`] = JSON.stringify(buildJsonSchema({ tag, docs }), null, 2) + '\n';
}

const stale: string[] = [];
const existing = existsSync(OUT) ? readdirSync(OUT).filter(f => f.endsWith('.schema.json')) : [];
for (const name of existing) if (!(name in files)) stale.push(`${name} (no such tag any more)`);
for (const [name, text] of Object.entries(files)) {
    const path = join(OUT, name);
    if (!existsSync(path) || readFileSync(path, 'utf8') !== text) stale.push(name);
}

if (check) {
    if (stale.length) {
        console.error(`schema/ is out of date — run \`bun run schema:build\`:\n  ${stale.join('\n  ')}`);
        process.exit(1);
    }
    console.log(`schema/ is up to date (${Object.keys(files).length} files)`);
} else {
    mkdirSync(OUT, { recursive: true });
    for (const name of existing) if (!(name in files)) rmSync(join(OUT, name));
    for (const [name, text] of Object.entries(files)) writeFileSync(join(OUT, name), text);
    for (const [name, text] of Object.entries(files)) console.log(`${name.padEnd(28)} ${(text.length / 1024).toFixed(1).padStart(6)} KiB`);
}
