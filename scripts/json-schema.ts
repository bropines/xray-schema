/**
 * JSON Schema (draft 2020-12) from the zod schemas, for every tag or one.
 *
 * zod 4's own `z.toJSONSchema` does the conversion; this adds what it cannot
 * know:
 *
 * - which keys a tag reads. The coverage walk pairs every zod object with the
 *   structs it stands for, and a key goes out of `properties` on a tag none of
 *   those structs decodes it on. An object the walk never paired (a finalmask
 *   layer's settings) is left whole: nothing is known, so nothing is dropped;
 * - `settings` by `protocol`. The wrapper schemas leave `settings` open; here
 *   each protocol the tag registers gets an `if protocol = … then settings`
 *   branch pointing at its settings schema;
 * - descriptions, from the schemas' JSDoc (scripts/descriptions.ts).
 *
 * Objects always stay open: the core drops a key it has no field for without
 * a word, so an unknown key is a no-op, not an error.
 */
import { z } from 'zod';
import * as S from '../src/schemas/index.js';
import { settingsSchemaFor } from '../src/schemas/settings-by-protocol.js';
import { fixture, keysReadAt, pairing, tagsOf } from '../src/walk.js';
import type { KeyDoc } from './descriptions.js';

type Json = Record<string, any>;
type Direction = 'inbound' | 'outbound';

/** Schemas worth a name of their own in `$defs`: what people link to and what repeats. */
const NAMED: [z.ZodType, string][] = [
    [S.InboundSchema, 'inbound'],
    [S.OutboundSchema, 'outbound'],
    [S.StreamSettingsSchema, 'streamSettings'],
    [S.SockoptSchema, 'sockopt'],
    [S.TlsSchema, 'tlsSettings'],
    [S.RealitySchema, 'realitySettings'],
    [S.FinalMaskSchema, 'finalmask'],
    [S.RoutingRuleSchema, 'routingRule'],
    [S.BalancerSchema, 'balancer'],
    [S.DnsServerObjectSchema, 'dnsServer'],
    [S.SniffingSchema, 'sniffing'],
    [S.MuxSchema, 'mux'],
];

/**
 * Second names the loader registers beside the first for the same struct; a
 * shared settings schema is named after the first (`tunnel`, not `dokodemo-door`).
 */
const ALIASES = new Set(['dokodemo-door', 'mixed', 'direct', 'block', 'shadowsocks-2022']);

/** The protocols a tag registers in one direction (all tags: undefined), first names first. */
const protocolsAt = (direction: Direction, tag?: string): string[] =>
    Object.entries(fixture.dispatch[direction])
        .filter(([, perTag]) => !tag || tagsOf(perTag).includes(tag))
        .map(([protocol]) => protocol)
        .sort((a, b) => Number(ALIASES.has(a)) - Number(ALIASES.has(b)) || a.localeCompare(b));

/**
 * One document. `tag` undefined: every key any supported tag reads, every
 * protocol any registers.
 */
export const buildJsonSchema = (opts: { tag?: string; docs: Map<object, Record<string, KeyDoc>> }): Json => {
    const { tag, docs } = opts;
    if (tag && !fixture.tags.includes(tag)) throw new Error(`not a supported tag: ${tag}`);
    const paired = pairing();
    const registry = z.registry<{ id: string }>();
    registry.add(S.XrayConfigSchema, { id: 'xray' });
    for (const [schema, id] of NAMED) registry.add(schema, { id });

    // settings schema → its $defs id; several protocols may share one (socks and mixed).
    const settingsIds = new Map<object, string>();
    const branches: Record<Direction, [string, string][]> = { inbound: [], outbound: [] };
    for (const direction of ['inbound', 'outbound'] as const) {
        for (const protocol of protocolsAt(direction, tag)) {
            const schema = settingsSchemaFor(direction, protocol);
            if (!schema) continue;
            if (!settingsIds.has(schema)) {
                const id = `${direction}Settings.${protocol}`;
                settingsIds.set(schema, id);
                registry.add(schema, { id });
            }
            branches[direction].push([protocol, settingsIds.get(schema)!]);
        }
    }

    /** Is this key read where this object stands? */
    const allTags = (pairs: ReturnType<typeof paired.get>, keys: string[]) => {
        const read = new Set<string>();
        for (const t of fixture.tags) for (const k of keysReadAt(pairs, keys, t) ?? keys) read.add(k);
        return read;
    };

    const override = ({ zodSchema, jsonSchema }: { zodSchema: unknown; jsonSchema: Json }) => {
        const schema = zodSchema as object;
        if (jsonSchema.type === 'object') {
            // Open, whatever zod says: the core ignores what it has no field for.
            if (jsonSchema.additionalProperties === false) delete jsonSchema.additionalProperties;
            const properties = jsonSchema.properties as Json | undefined;
            if (properties) {
                const keys = Object.keys(properties);
                const pairs = paired.get(schema);
                const read = tag ? keysReadAt(pairs, keys, tag) : allTags(pairs, keys);
                if (read) {
                    for (const key of keys) if (!read.has(key)) delete properties[key];
                    if (Array.isArray(jsonSchema.required)) {
                        jsonSchema.required = jsonSchema.required.filter((k: string) => k in properties);
                        if (!jsonSchema.required.length) delete jsonSchema.required;
                    }
                }
                for (const [key, doc] of Object.entries(docs.get(schema) ?? {})) {
                    const prop = properties[key];
                    if (!prop) continue;
                    if (doc.description) {
                        prop.description = doc.description;
                        // The comments are written in Markdown already: `key`, “…”.
                        prop.markdownDescription = doc.description;
                    }
                    if (doc.deprecated) prop.deprecated = true;
                }
            }
        }
        const direction = schema === S.InboundSchema ? 'inbound' : schema === S.OutboundSchema ? 'outbound' : null;
        if (direction) {
            jsonSchema.allOf = branches[direction].map(([protocol, id]) => ({
                if: { properties: { protocol: { const: protocol } }, required: ['protocol'] },
                then: { properties: { settings: { $ref: `#/$defs/${id}` } } },
            }));
        }
    };

    // Everything that has to end up in $defs hangs off one carrier object, so
    // one conversion sees it all and refs stay inside one document.
    const carrier = z.object(Object.fromEntries([
        ['root', S.XrayConfigSchema],
        ...[...settingsIds.keys()].map((s, i) => [`settings${i}`, s as z.ZodType]),
    ]));
    const converted = z.toJSONSchema(carrier, {
        target: 'draft-2020-12',
        io: 'input',
        unrepresentable: 'any',
        metadata: registry,
        reused: 'inline',
        cycles: 'ref',
        override: ctx => override(ctx as any),
    }) as Json;

    const defs = { ...(converted.$defs as Json) };
    const root = defs.xray as Json;
    delete defs.xray;
    const subject = tag ? `Xray-core ${tag}` : `Xray-core, every release from ${fixture.tags[0]} to ${fixture.tags.at(-1)}`;
    const { $schema: _drop, id: _id, ...body } = root;
    return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        title: tag ? `Xray-core ${tag} config` : 'Xray-core config',
        description: `The keys ${subject} reads from a config, from xray-schema (github.com/bropines/xray-schema). Unknown keys are allowed: the core ignores them.`,
        ...body,
        $defs: Object.fromEntries(Object.entries(defs).sort(([a], [b]) => a.localeCompare(b)).map(([id, def]) => {
            const { id: _i, ...rest } = def as Json;
            return [id, rest];
        })),
    };
};
