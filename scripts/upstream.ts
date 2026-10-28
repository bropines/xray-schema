/**
 * New Xray-core releases → a regenerated fixture and a PR body.
 *
 *   bun run scripts/upstream.ts <Xray-core clone> [--body <file>]
 *
 * Finds release tags at or above the floor that `src/core-keys.json` does not
 * have yet; if there are none it says so and changes nothing. Otherwise it
 * regenerates the fixture and the JSON Schemas, runs the coverage test, and
 * writes a Markdown body saying, for each new tag, which structs gained or
 * lost keys (or changed a key's type) against the tag before it.
 *
 * It does not touch the zod schemas: a failing coverage test in the PR is
 * the signal that a human has to read the new release and update them.
 * Prints `new=<tags>` for the workflow (empty when nothing is new).
 */
import { execFileSync, spawnSync } from 'child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ROOT, releaseSet } from './tags.js';

type PerTag = string | Record<string, string>;
interface Fixture {
    tags: string[];
    dispatch: Record<string, Record<string, PerTag>>;
    structs: Record<string, Record<string, PerTag>>;
}

const repo = process.argv[2];
if (!repo) throw new Error('usage: bun run scripts/upstream.ts <Xray-core clone> [--body <file>]');
const bodyAt = process.argv.indexOf('--body');
const bodyFile = bodyAt > 0 ? process.argv[bodyAt + 1] : undefined;
const FIXTURE = join(ROOT, 'src/core-keys.json');

const read = (): Fixture => JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture;
const output = (line: string) => {
    console.log(line);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`);
};

const before = read();
const fresh = releaseSet(repo).map(r => r.tag).filter(t => !before.tags.includes(t));
if (!fresh.length) {
    output('new=');
    process.exit(0);
}

const run = (args: string[]) => execFileSync('bun', args, { cwd: ROOT, stdio: 'inherit' });
run(['run', 'scripts/core-keys.ts', repo]);
run(['run', 'scripts/build-json-schema.ts']);
const after = read();

const at = (v: PerTag | undefined, tag: string) => (v === undefined ? undefined : typeof v === 'string' ? (after.tags.includes(tag) ? v : undefined) : v[tag]);

/** One tag against the one before it: what a config can now say, and what it can no longer. */
const compare = (tag: string, prev: string): string[] => {
    const lines: string[] = [];
    for (const [name, keys] of Object.entries(after.structs)) {
        const gained: string[] = [];
        const lost: string[] = [];
        const retyped: string[] = [];
        for (const [key, v] of Object.entries(keys)) {
            const [now, then] = [at(v, tag), at(v, prev)];
            if (now && !then) gained.push(`\`${key}\` (${now})`);
            else if (!now && then) lost.push(`\`${key}\``);
            else if (now && then && now !== then) retyped.push(`\`${key}\` ${then} → ${now}`);
        }
        const parts = [
            gained.length && `gained ${gained.join(', ')}`,
            lost.length && `lost ${lost.join(', ')}`,
            retyped.length && `retyped ${retyped.join(', ')}`,
        ].filter(Boolean);
        if (parts.length) lines.push(`- **${name}**: ${parts.join('; ')}`);
    }
    for (const [direction, protocols] of Object.entries(after.dispatch)) {
        for (const [protocol, v] of Object.entries(protocols)) {
            const [now, then] = [at(v, tag), at(v, prev)];
            if (now && !then) lines.push(`- ${direction} protocol \`${protocol}\` registered (${now})`);
            else if (!now && then) lines.push(`- ${direction} protocol \`${protocol}\` gone`);
        }
    }
    return lines;
};

const coverage = spawnSync('bun', ['test', 'test/coverage.test.ts'], { cwd: ROOT, encoding: 'utf8' });
const passed = coverage.status === 0;

const body: string[] = [
    `New Xray-core release${fresh.length > 1 ? 's' : ''}: ${fresh.map(t => `\`${t}\``).join(', ')}.`,
    '',
    'Regenerated `src/core-keys.json` and `schema/` from the tags (`scripts/upstream.ts`). The zod schemas are untouched.',
    '',
];
for (const tag of fresh) {
    const i = after.tags.indexOf(tag);
    const prev = after.tags[i - 1];
    body.push(`### ${tag}${prev ? ` against ${prev}` : ''}`, '');
    const changes = prev ? compare(tag, prev) : ['- the first tag in the set'];
    body.push(...(changes.length ? changes : ['- no struct gained or lost a key: the zod schemas need no change.']), '');
}
body.push(
    '### Coverage test',
    '',
    passed
        ? 'Passes: every key the new tags decode has a zod counterpart of a type they can decode.'
        : 'Fails — the zod schemas need updating by hand. Read the new tags\' `infra/conf` for each finding, change `src/schemas/**` (or add an `ALLOWED` entry with its reason), then `bun run schema:build`.',
    '',
);
if (!passed) {
    const report = `${coverage.stdout}\n${coverage.stderr}`.split('\n').filter(l => /^\+\s+"/.test(l)).map(l => l.replace(/^\+\s+"|",?$/g, ''));
    if (report.length) body.push('```', ...report.slice(0, 80), '```', '');
}

const text = body.join('\n');
if (bodyFile) writeFileSync(bodyFile, text);
else console.log(text);
output(`new=${fresh.join(' ')}`);
output(`coverage=${passed ? 'pass' : 'fail'}`);
