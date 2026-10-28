import { describe, expect, it } from 'bun:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseJsonc, supportedTags } from '../src/index.js';
import { keyDocs } from '../scripts/descriptions.js';
import { buildJsonSchema } from '../scripts/json-schema.js';
import pkg from '../package.json' with { type: 'json' };

const ROOT = join(import.meta.dir, '..');
const committed = (name: string) => JSON.parse(readFileSync(join(ROOT, 'schema', name), 'utf8'));
const sample = (name: string) => parseJsonc(readFileSync(join(import.meta.dir, 'samples', name), 'utf8')).value;

const docs = await keyDocs();
const ajv = new Ajv2020({ allErrors: true, strict: true });
// VS Code's own keyword; the validator only has to know it is not a typo.
ajv.addKeyword('markdownDescription');

describe('JSON Schema', () => {

    it('is what the build writes (run `bun run schema:build` if not)', () => {
        expect(buildJsonSchema({ docs, version: pkg.version })).toEqual(committed('xray.schema.json'));
        for (const tag of ['v26.3.27', 'v26.4.13', 'v26.10.21']) {
            expect(buildJsonSchema({ tag, docs, version: pkg.version })).toEqual(committed(`${tag}.schema.json`));
        }
    });

    it('compiles under a strict draft 2020-12 validator, every file', () => {
        for (const name of ['xray', ...supportedTags]) {
            const schema = committed(`${name}.schema.json`);
            expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
            expect(() => ajv.compile(schema)).not.toThrow();
            ajv.removeSchema();
        }
    });

    it('accepts the good samples and refuses the bad one where lint() does', () => {
        for (const name of ['xray', ...supportedTags]) {
            const validate = ajv.compile(committed(`${name}.schema.json`));
            for (const good of ['server.jsonc', 'client.json']) {
                expect({ name, good, ok: validate(sample(good)), errors: validate.errors ?? null }).toEqual({ name, good, ok: true, errors: null });
            }
            expect(validate(sample('bad.jsonc'))).toBe(false);
            const paths = new Set(validate.errors!.map(e => e.instancePath));
            expect(paths).toContain('/inbounds/0/settings/clients/0/flow');
            expect(paths).toContain('/routing/rules/0/webhook');
            expect(paths).toContain('/routing/balancers/0/strategy/settings/maxRTT');
            ajv.removeSchema();
        }
    });

    it('leaves objects open: an unknown key is not an error', () => {
        const validate = ajv.compile(committed('v26.7.28.schema.json'));
        expect(validate({ somethingNew: 1, routing: { rules: [{ outboundTag: 'direct', notAKey: true }] } })).toBe(true);
        ajv.removeSchema();
    });

    // A few paths, pinned: what changes here changes for everyone's editor.
    it('keeps per tag only the keys that tag reads', () => {
        const at = (tag: string) => committed(`${tag}.schema.json`);
        const protocols = (s: any, d: 'inbound' | 'outbound') => s.$defs[d].allOf.map((b: any) => b.if.properties.protocol.const).sort();
        expect({
            rootAll: Object.keys(committed('xray.schema.json').properties).sort(),
            root263: Object.keys(at('v26.3.27').properties).sort(),
            rule263: Object.keys(at('v26.3.27').$defs.routingRule.properties).sort(),
            ruleAll: Object.keys(committed('xray.schema.json').$defs.routingRule.properties).sort(),
            routing261021: Object.keys(at('v26.10.21').properties.routing.properties).sort(),
            inbound263: protocols(at('v26.3.27'), 'inbound'),
            inbound261021: protocols(at('v26.10.21'), 'inbound'),
            outbound261021: protocols(at('v26.10.21'), 'outbound'),
            transports2693: Object.keys(at('v26.9.30').$defs.streamSettings.properties).sort(),
        }).toMatchSnapshot();
    });

    it('carries the schemas\' own documentation', () => {
        const env = committed('xray.schema.json').properties.env;
        expect(env.description).toContain('env:NAME');
        expect(env.markdownDescription).toBe(env.description);
        // Sentences about the editor these schemas came from are left out.
        const text = JSON.stringify(committed('xray.schema.json'));
        expect(text).not.toMatch(/core\/xray\//);
    });
});
