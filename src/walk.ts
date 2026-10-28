/**
 * The zod schemas walked beside the structs every tag decodes.
 *
 * The walk pairs the root `Config` with XrayConfigSchema and descends both at
 * once: a struct-typed key is checked against the zod object at that key, a
 * protocol's `settings` against `settingsSchemaFor`. It yields two things:
 *
 * - `findings`: a decoded key with no zod counterpart, a zod type the core
 *   cannot decode, a zod key no tag reads — what `test/coverage.test.ts`
 *   holds to its ALLOWED table;
 * - `paired`: for every zod object, the structs it stood for — which is how
 *   the JSON Schema build and `lint()` know which keys a given tag reads.
 */
import fixtureJson from './core-keys.json' with { type: 'json' };
import { XrayConfigSchema } from './schemas/index.js';
import { settingsSchemaFor } from './schemas/settings-by-protocol.js';

export type PerTag = string | Record<string, string>;
export interface Fixture {
    tags: string[];
    lines: Record<string, string>;
    refs: Record<string, string>;
    customUnmarshalers: string[];
    dispatch: Record<'inbound' | 'outbound', Record<string, PerTag>>;
    structs: Record<string, Record<string, PerTag>>;
}
export const fixture = fixtureJson as unknown as Fixture;
const { structs, dispatch } = fixture;

export const typesOf = (v: PerTag): string[] => [...new Set(typeof v === 'string' ? [v] : Object.values(v))];
/** The tags a key (or a protocol) exists on. */
export const tagsOf = (v: PerTag): string[] => (typeof v === 'string' ? fixture.tags : Object.keys(v));

// --- What a Go type accepts, as JSON ---------------------------------------

type Kind =
    | { k: 'string' | 'number' | 'boolean' | 'any' }
    | { k: 'array'; of: Kind[] }
    | { k: 'map'; of: Kind[] }
    | { k: 'object'; struct?: string; dispatch?: 'inbound' | 'outbound' };

const STRING: Kind = { k: 'string' };
const NUMBER: Kind = { k: 'number' };

/**
 * Types with an UnmarshalJSON of their own (or decoded by hand), read from
 * v26.10.21:infra/conf/common.go:28-330 unless said otherwise; every tag has
 * the same decoder. A new one in `customUnmarshalers` fails the coverage test
 * until it is read and added here.
 */
export const CUSTOM: Record<string, Kind[]> = {
    // A JSON array of strings, or one string split on ",".
    StringList: [STRING, { k: 'array', of: [STRING] }],
    NetworkList: [STRING, { k: 'array', of: [STRING] }],
    // A string only; "env:NAME" reads the environment.
    Address: [STRING],
    // A number, or a "from-to" / "env:" string. PortList's string may hold a comma list.
    PortRange: [NUMBER, STRING],
    PortList: [NUMBER, STRING],
    // A number, or "a-b" (negative ends allowed).
    Int32Range: [NUMBER, STRING],
    // infra/conf/cfgcommon/duration/duration.go:18-36 — a Go duration string; a number is refused.
    Duration: [STRING],
    // dns.go:39-41 — a bare address string, or the full object.
    NameServerConfig: [STRING, { k: 'object', struct: 'NameServerConfig' }],
    // dns.go:198-209 — one address, or a list of them.
    HostAddress: [STRING, { k: 'array', of: [STRING] }],
    // dns.go:248-256 — a map of domain rule → HostAddress.
    HostsWrapper: [{ k: 'map', of: [STRING, { k: 'array', of: [STRING] }] }],
    // fakedns.go:36-48 — one pool object, or a list of them.
    FakeDNSConfig: [{ k: 'object', struct: 'FakeDNSPoolElementConfig' }, { k: 'array', of: [{ k: 'object', struct: 'FakeDNSPoolElementConfig' }] }],
    // transport_sockopt.go:28-45 — the struct, with its own defaults.
    HappyEyeballsConfig: [{ k: 'object', struct: 'HappyEyeballsConfig' }],
    // Decoded by hand (see RAW in scripts/core-keys.ts).
    StringOrNumber: [STRING, NUMBER],
    BoolOrNumber: [{ k: 'boolean' }, NUMBER],
};

const INTEGER = /^(u?int(8|16|32|64)?|byte|float32|float64)$/;

const goKinds = (type: string): Kind[] => {
    if (CUSTOM[type]) return CUSTOM[type]!;
    if (type === 'string') return [STRING];
    if (type === 'bool') return [{ k: 'boolean' }];
    if (INTEGER.test(type)) return [NUMBER];
    if (type === 'json.RawMessage' || type === 'interface{}' || type.startsWith('opaque:')) return [{ k: 'any' }];
    // encoding/json reads []byte from a base64 string, or from an array of numbers.
    if (type === '[]byte') return [STRING, { k: 'array', of: [NUMBER] }];
    if (type.startsWith('[]')) return [{ k: 'array', of: goKinds(type.slice(2)) }];
    const map = /^map\[\w+\](.+)$/.exec(type);
    if (map) return [{ k: 'map', of: goKinds(map[1]!) }];
    if (type === 'dispatch:inbound' || type === 'dispatch:outbound') return [{ k: 'object', dispatch: type.slice(9) as 'inbound' | 'outbound' }];
    if (structs[type]) return [{ k: 'object', struct: type }];
    throw new Error(`no JSON kind for Go type ${type}`);
};

// --- What a zod schema accepts ---------------------------------------------

type Any = any;
const def = (s: Any): Any => s?._def ?? {};
const kindTag = (s: Any): string => def(s).type ?? '';

export const unwrap = (s: Any): Any => {
    let current = s;
    for (;;) {
        const t = kindTag(current);
        if (['optional', 'nullable', 'default', 'prefault', 'catch', 'readonly', 'nonoptional'].includes(t)) current = def(current).innerType;
        else if (t === 'lazy') current = def(current).getter();
        // A transform reads its input side.
        else if (def(current).in && def(current).out) current = def(current).in;
        else return current;
    }
};

interface ZKind { k: Kind['k']; schema: Any; of?: ZKind[] }

const zodKinds = (schema: Any): ZKind[] => {
    const s = unwrap(schema);
    switch (kindTag(s)) {
        case 'string': case 'enum': case 'template_literal': return [{ k: 'string', schema: s }];
        case 'number': case 'int': case 'bigint': return [{ k: 'number', schema: s }];
        case 'boolean': return [{ k: 'boolean', schema: s }];
        case 'literal': {
            const values: unknown[] = def(s).values ?? [def(s).value];
            return [...new Set(values.map(v => typeof v))].map(t =>
                ({ k: t === 'number' ? 'number' : t === 'boolean' ? 'boolean' : 'string', schema: s } as ZKind));
        }
        case 'array': return [{ k: 'array', schema: s, of: zodKinds(def(s).element) }];
        case 'object': return [{ k: 'object', schema: s }];
        case 'record': return [{ k: 'map', schema: s, of: zodKinds(def(s).valueType) }];
        case 'union': {
            // Branches that are objects stand for one object whose keys are
            // any branch's — `{type: "none"} | {type: "http", request, …}`.
            const kinds = (def(s).options as Any[]).flatMap(zodKinds);
            const objects = kinds.filter(k => k.k === 'object');
            return objects.length > 1 ? [...kinds.filter(k => k.k !== 'object'), { k: 'object', schema: s }] : kinds;
        }
        default: return [{ k: 'any', schema: s }];
    }
};

const shapeOf = (s: Any): Record<string, Any> => {
    const bare = unwrap(s);
    if (kindTag(bare) === 'union') return Object.assign({}, ...(def(bare).options as Any[]).map(shapeOf));
    return (bare.shape ?? def(bare).shape ?? {}) as Record<string, Any>;
};

/** The zod objects a schema stands for: itself, or each object branch of a union. */
const objectsOf = (s: Any): object[] => {
    const bare = unwrap(s);
    if (kindTag(bare) === 'union') return (def(bare).options as Any[]).flatMap(objectsOf);
    return kindTag(bare) === 'object' ? [bare] : [];
};

// --- The walk -----------------------------------------------------------------

export type Finding = { id: string; path: string; problem: 'missing' | 'type' | 'extra' | 'opaque'; detail: string };

export interface Pairing {
    /** The structs this zod object stood for, wherever the walk met it. */
    structs: string[];
    /** The first path it was met at, for messages. */
    path: string;
}

const describeKinds = (ks: { k: string; of?: { k: string }[] }[]): string =>
    ks.map(k => (k.of ? `${k.k}<${describeKinds(k.of)}>` : k.k)).join('|');

/** `on every tag`, or the tags it is on. */
const onTags = (v: PerTag) => (typeof v === 'string' ? 'every tag' : Object.keys(v).join(', '));

export const walk = (): { findings: Finding[]; paired: Map<object, Pairing> } => {
    const findings: Finding[] = [];
    const seen = new Set<string>();
    const ids = new WeakMap<object, number>();
    let next = 0;
    const idOf = (o: object) => { if (!ids.has(o)) ids.set(o, next++); return ids.get(o)!; };
    const paired = new Map<object, Pairing & { shape: Record<string, Any> }>();

    /** Does some zod kind accept everything this Go kind accepts? Recurses into structs. */
    const covers = (g: Kind, zs: ZKind[], path: string, owner: string): boolean => {
        if (g.k === 'any') return true;
        // `settings` is left open by the wrapper schemas and looked up by protocol.
        if (g.k === 'object' && g.dispatch) {
            for (const [protocol, perTag] of Object.entries(dispatch[g.dispatch])) {
                const settings = settingsSchemaFor(g.dispatch, protocol);
                for (const struct of typesOf(perTag)) {
                    if (!settings) findings.push({ id: `${g.dispatch}:${protocol}`, path: `${path}<${protocol}>`, problem: 'missing', detail: `no settings schema for protocol "${protocol}" (${struct})` });
                    else checkStruct(struct, settings, `${path}<${protocol}>`);
                }
            }
            return true;
        }
        const z = zs.find(z => z.k === g.k)
            ?? zs.find(z => z.k === 'any')
            ?? zs.find(z => (g.k === 'map' && z.k === 'object') || (g.k === 'object' && z.k === 'map'));
        if (!z) return false;
        if (z.k === 'any') {
            if (g.k === 'object' || g.k === 'array' || g.k === 'map') findings.push({ id: owner, path, problem: 'opaque', detail: `zod accepts anything where the core decodes ${describeKinds([g])}` });
            return true;
        }
        if (g.k === 'array' || g.k === 'map') {
            if (z.k === 'object') return true; // a map against a fixed-shape object: keys are checked where it has them
            return g.of!.every(e => covers(e, z.of ?? [], `${path}[]`, owner));
        }
        if (g.k === 'object') {
            if (z.k === 'map') {
                if (g.struct && Object.keys(structs[g.struct] ?? {}).length) {
                    findings.push({ id: owner, path, problem: 'opaque', detail: `zod has a record where the core decodes ${g.struct}` });
                }
                return true;
            }
            if (g.struct) checkStruct(g.struct, z.schema, path);
        }
        return true;
    };

    const checkStruct = (struct: string, schema: Any, path: string) => {
        const key = `${struct}@${idOf(unwrap(schema))}`;
        if (seen.has(key)) return;
        seen.add(key);
        const goKeys = structs[struct] ?? {};
        const shape = shapeOf(schema);
        const lower = new Map(Object.keys(shape).map(k => [k.toLowerCase(), k]));
        for (const [goKey, perTag] of Object.entries(goKeys)) {
            const id = `${struct}.${goKey}`;
            const at = `${path}.${goKey}`;
            // encoding/json matches a key case-insensitively when no exact match exists.
            const zKey = goKey in shape ? goKey : lower.get(goKey.toLowerCase());
            if (!zKey) {
                findings.push({ id, path: at, problem: 'missing', detail: `${typesOf(perTag).join(' / ')} on ${onTags(perTag)}` });
                continue;
            }
            const zs = zodKinds(shape[zKey]);
            const gs = typesOf(perTag).flatMap(goKinds);
            const refused = gs.filter(g => !covers(g, zs, at, id));
            if (refused.length) findings.push({ id, path: at, problem: 'type', detail: `core decodes ${describeKinds(gs)}, zod takes ${describeKinds(zs)}` });
            // The other way: a shape zod lets through that the core cannot decode.
            if (!gs.some(g => g.k === 'any' || (g.k === 'object' && g.dispatch))) {
                const loose = zs.filter(z => z.k !== 'any' && !gs.some(g => g.k === z.k || (g.k === 'map' && z.k === 'object')));
                if (loose.length && !refused.length) findings.push({ id, path: at, problem: 'type', detail: `zod also takes ${describeKinds(loose)}, the core decodes only ${describeKinds(gs)}` });
            }
        }
        // Extras are judged once the walk is done, against every struct this
        // zod object stood for: blackhole's `response` is one struct on 26.7
        // and another from 26.9, and one schema covers both. A union stands
        // for each of its object branches.
        for (const object of objectsOf(schema)) {
            const entry = paired.get(object) ?? { structs: [], path, shape: shapeOf(object) };
            if (!entry.structs.includes(struct)) entry.structs.push(struct);
            paired.set(object, entry);
        }
    };

    checkStruct('Config', XrayConfigSchema, '');
    for (const { structs: names, path, shape } of paired.values()) {
        const goLower = new Set(names.flatMap(n => Object.keys(structs[n] ?? {})).map(k => k.toLowerCase()));
        for (const zKey of Object.keys(shape)) {
            if (!goLower.has(zKey.toLowerCase())) findings.push({ id: `${names[0]}.${zKey}`, path: `${path}.${zKey}`, problem: 'extra', detail: 'no supported tag decodes it' });
        }
    }
    // An extra found through several union branches is one finding.
    const unique = new Map(findings.map(f => [`${f.problem} ${f.id} ${f.path} ${f.detail}`, f]));
    return { findings: [...unique.values()], paired };
};

/**
 * The keys of a zod object that `tag` decodes, matched as encoding/json
 * matches them (exactly, else case-insensitively). Null for an object the
 * walk never paired with a struct — nothing is known about it, so nothing is
 * dropped.
 */
export const keysReadAt = (pairing: Pairing | undefined, shapeKeys: string[], tag: string): Set<string> | null => {
    if (!pairing) return null;
    const read = new Set<string>();
    for (const struct of pairing.structs) {
        for (const [goKey, perTag] of Object.entries(structs[struct] ?? {})) {
            if (tagsOf(perTag).includes(tag)) read.add(goKey.toLowerCase());
        }
    }
    return new Set(shapeKeys.filter(k => read.has(k.toLowerCase())));
};

let cached: Map<object, Pairing> | undefined;
/** The pairing alone, computed once: lint() asks it for every object it visits. */
export const pairing = (): Map<object, Pairing> => (cached ??= walk().paired);
