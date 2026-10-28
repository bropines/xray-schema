/**
 * What every supported core decodes from a config, key by key and tag by
 * tag — the fixture `test/coverage.test.ts` holds the zod schemas to.
 *
 *   bun run core-keys <Xray-core clone>
 *
 * Writes `src/core-keys.json`: every struct the root `Config` reaches in
 * `infra/conf` (plus the few protobuf structs a user entry is decoded into),
 * each key with its Go type on each tag, and which struct each protocol's
 * `settings` becomes. The tags are the release set in `versions.json`.
 *
 * Read from the tags' source, never a branch, through `git cat-file`, so the
 * clone's checked-out branch does not matter and nothing in it is touched.
 *
 * The walk is mechanical except where the core decodes a `json.RawMessage` or
 * an `interface{}` itself: what it becomes is code, not a struct tag, and is
 * written down in RAW below with the line that does it. A raw field the walk
 * reaches that RAW does not name stops the script — a new release that adds
 * one needs a human to read what it is decoded into.
 */
import { execFileSync, spawnSync } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { ROOT, readVersions, releaseSet, type Release } from './tags.js';

const repo = process.argv[2];
if (!repo) throw new Error('usage: bun run core-keys <Xray-core clone>');
export const OUT = join(ROOT, 'src/core-keys.json');

const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** Many files at once: one `git cat-file --batch` instead of a process per file. */
const readFiles = (ref: string, paths: string[]): string[] => {
    const res = spawnSync('git', ['cat-file', '--batch'], {
        cwd: repo, input: paths.map(p => `${ref}:${p}`).join('\n') + '\n', maxBuffer: 256 * 1024 * 1024,
    });
    if (res.status !== 0) throw new Error(`git cat-file failed: ${res.stderr}`);
    const buf = res.stdout as Buffer;
    const out: string[] = [];
    let at = 0;
    for (const path of paths) {
        const nl = buf.indexOf(10, at);
        const header = buf.subarray(at, nl).toString();
        if (header.endsWith('missing')) throw new Error(`${ref}: no ${path}`);
        const size = Number(header.split(' ')[2]);
        out.push(buf.subarray(nl + 1, nl + 1 + size).toString('utf8'));
        at = nl + 1 + size + 1;
    }
    return out;
};

/**
 * Protobuf structs a config is decoded into directly — a VLESS user entry is
 * unmarshalled into `protocol.User` and then into `vless.Account`
 * (v26.10.21:infra/conf/vless.go:57-63). Their json tags are what the decoder
 * reads, so they are parsed like the conf structs, under their package name.
 */
const PROTO_FILES: Record<string, string> = {
    'common/protocol/user.pb.go': 'protocol',
    'proxy/vless/account.pb.go': 'vless',
    'app/router/config.pb.go': 'router',
};

interface Struct { fields: Record<string, string>; embeds: string[] }

/** Every `type X struct {…}` in a file, nested ones (declared in a func) included. */
const parseStructs = (src: string, pkg: string | null, into: Record<string, Struct>, aliases: Record<string, string>) => {
    const qualify = (name: string) => (pkg ? `${pkg}.${name}` : name);
    const re = /\btype\s+(\w+)\s+struct\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
        let depth = 1;
        let i = re.lastIndex;
        while (depth > 0 && i < src.length) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            i++;
        }
        const body = src.slice(re.lastIndex, i - 1);
        const struct: Struct = { fields: {}, embeds: [] };
        let level = 0;
        for (const raw of body.split('\n')) {
            const line = raw.replace(/\/\/.*$/, '');
            const atTop = level === 0;
            level += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
            if (!atTop) continue;
            const field = /^\s*([A-Za-z_]\w*)\s+([^\s`]+)\s*(`[^`]*`)?\s*$/.exec(line);
            if (field) {
                const [, name, type, tags] = field;
                const json = tags ? /json:"([^"]*)"/.exec(tags)?.[1]?.split(',')[0] : undefined;
                if (json === '-') continue;
                if (!json && !/^[A-Z]/.test(name!)) continue; // unexported, invisible to encoding/json
                struct.fields[json || name!] = pkg ? qualifyType(type!, pkg) : type!;
                continue;
            }
            const embed = /^\s*\*?([A-Z][\w.]*)\s*(`[^`]*`)?\s*$/.exec(line);
            if (embed) struct.embeds.push(pkg && !embed[1]!.includes('.') ? qualify(embed[1]!) : embed[1]!);
        }
        into[qualify(m[1]!)] = struct;
    }
    // Named non-struct types: `type StringList []string`, `type Bandwidth string`.
    for (const a of src.matchAll(/^type\s+(\w+)\s+([^\s{]+)\s*$/gm)) aliases[qualify(a[1]!)] = a[2]!;
};

const BASIC = new Set(['string', 'bool', 'byte', 'int', 'int8', 'int16', 'int32', 'int64',
    'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'float32', 'float64', 'interface{}', 'json.RawMessage']);

/** `*Reverse` inside vless.Account means `*vless.Reverse`. */
const qualifyType = (type: string, pkg: string): string =>
    type.replace(/(^|[\]*])([A-Z]\w*)$/, (_, pre, name) => `${pre}${pkg}.${name}`);

/** Loaders: `NewJSONConfigLoader(ConfigCreatorCache{"id": func() … new(X) …}, "idKey", "configKey")`. */
interface Loader { idKey: string; configKey: string; variants: Record<string, string> }
const parseLoaders = (src: string, consts: Record<string, string>, into: Record<string, Loader>) => {
    const re = /(\w+)\s*=\s*NewJSONConfigLoader\(\s*ConfigCreatorCache\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
        let depth = 1;
        let i = re.lastIndex;
        while (depth > 0 && i < src.length) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            i++;
        }
        const body = src.slice(re.lastIndex, i - 1);
        const keys = /^\s*,\s*"(\w*)"\s*,\s*"(\w*)"\s*,?\s*\)/.exec(src.slice(i));
        if (!keys) throw new Error(`loader ${m[1]}: cannot read its id and config keys`);
        const variants: Record<string, string> = {};
        for (const v of body.matchAll(/(?:"([\w-]+)"|(\w+))\s*:\s*func\(\)\s*interface\{\}\s*\{\s*return\s+(?:new\((\w+)\)|&(\w+)\{)/g)) {
            const id = v[1] ?? consts[v[2]!];
            if (!id) throw new Error(`loader ${m[1]}: cannot resolve ${v[2]}`);
            variants[id] = (v[3] ?? v[4])!;
        }
        into[m[1]!] = { idKey: keys[1]!, configKey: keys[2]!, variants };
    }
};

/**
 * What the core turns a raw field into, keyed `Struct.key`. A type here is
 * written in the same grammar as a struct field's; `loader:<var>` means the
 * object is handed to that JSONConfigLoader, `dispatch:inbound`/`outbound`
 * the protocol registries in xray.go. `json.RawMessage` means the core only
 * refuses or copies it — nothing inside it is read.
 *
 * Each entry cites the tag it was read at; a release in between that turned
 * a field raw (or stopped) is caught by the "no entry in RAW" check below.
 */
const RAW: Record<string, string> = {
    // v26.10.21:infra/conf/xray.go:727 — any global transport is a removed feature.
    'Config.transport': 'map[string]json.RawMessage',
    'InboundDetourConfig.settings': 'dispatch:inbound',
    'OutboundDetourConfig.settings': 'dispatch:outbound',
    // v26.9.9:infra/conf/xray.go — any proxySettings is a removed feature from 26.9; 26.3/26.7 type it as ProxyConfig.
    'OutboundDetourConfig.proxySettings': 'json.RawMessage',
    // v26.10.21:infra/conf/router.go:287-299 — every rule goes through parseFieldRule.
    'RouterConfig.rules': '[]RawFieldRule',
    'StrategyConfig.settings': 'loader:strategyConfigLoader',
    // v26.10.21:infra/conf/vless.go:55-63 — protocol.User, then vless.Account, from the same object.
    'VLessInboundConfig.users': '[]VLessUser',
    'VLessInboundConfig.clients': '[]VLessUser',
    'VLessOutboundVnext.users': '[]VLessUser',
    // v26.10.21:infra/conf/vmess.go:79-86, 151-166
    'VMessInboundConfig.users': '[]VMessUser',
    'VMessInboundConfig.clients': '[]VMessUser',
    'VMessOutboundTarget.users': '[]VMessUser',
    // v26.10.21:infra/conf/socks.go:111-125, http.go:94-108
    'SocksRemoteConfig.users': '[]SocksUser',
    'HTTPRemoteConfig.users': '[]HTTPUser',
    // v26.10.21:infra/conf/vless.go:164-167, trojan.go:154-157 — a port number or an address string.
    'VLessInboundFallback.dest': 'StringOrNumber',
    'TrojanInboundFallback.dest': 'StringOrNumber',
    // v26.10.21:infra/conf/transport_security.go:59-68 — the same two tries.
    'REALITYConfig.target': 'StringOrNumber',
    'REALITYConfig.dest': 'StringOrNumber',
    // v26.10.21:infra/conf/transport_method.go:236-253 — {"type": "none"|"http", …}.
    'TCPConfig.header': 'loader:tcpHeaderLoader',
    // v26.7.28:infra/conf/transport_method.go:537 — header and seed are a removed feature; 26.9+ only copies them.
    'KCPConfig.header': 'json.RawMessage',
    // v26.10.21:infra/conf/transport_method.go — `extra` is the same struct again.
    'SplitHTTPConfig.extra': 'SplitHTTPConfig',
    // v26.10.21:infra/conf/transport_method.go:1052 — passed on as text, read by the xdrive service.
    'XDriveConfig.template': 'json.RawMessage',
    // v26.3.27/v26.7.28:infra/conf/blackhole.go:45-51 — {"type": "none"|"http"}.
    'BlackholeConfig.response': 'loader:configLoader',
    // v26.3.27:infra/conf/transport_internet.go:1925 — unmarshalled into a PortList.
    'UdpHop.ports': 'PortList',
    // v26.10.21:infra/conf/transport_sockopt.go:70-85 — a bool or a number; anything else is refused.
    'SocketConfig.tcpFastOpen': 'BoolOrNumber',
    // proxyman.SniffingConfig is protobuf; VLESS refuses it on an inbound user (v26.10.21:infra/conf/vless.go:92-94).
    'vless.Reverse.sniffing': 'json.RawMessage',
    // A finalmask layer's settings are decoded per mask type, by code a
    // struct walk cannot follow; the zod schema types them per type instead.
    'Mask.settings': 'opaque:finalmask',
};

/** Structs the core builds out of two decodes of one object. */
const SYNTHETIC: Record<string, { embeds: string[]; drop?: string[] }> = {
    VLessUser: { embeds: ['protocol.User', 'vless.Account'], drop: ['account'] },
    VMessUser: { embeds: ['protocol.User', 'VMessAccount'], drop: ['account'] },
    SocksUser: { embeds: ['protocol.User', 'SocksAccount'], drop: ['account'] },
    HTTPUser: { embeds: ['protocol.User', 'HTTPAccount'], drop: ['account'] },
};

type PerTag = Record<string, string>;
const structs: Record<string, Record<string, PerTag>> = {};
const dispatch: Record<string, Record<string, PerTag>> = { inbound: {}, outbound: {} };
const customUnmarshal = new Set<string>();
const unknownRaw = new Set<string>();

const walkTag = ({ tag, ref }: Release) => {
    const files = git('ls-tree', '--name-only', ref, 'infra/conf/').split('\n')
        .filter(f => f.endsWith('.go') && !f.endsWith('_test.go'));
    const parsed: Record<string, Struct> = {};
    const aliases: Record<string, string> = {};
    const loaders: Record<string, Loader> = {};
    const consts: Record<string, string> = {};
    const unmarshalers = new Set<string>();
    const sources = readFiles(ref, files);
    for (const src of sources) {
        for (const c of src.matchAll(/^\s*(\w+)\s+(?:string\s+)?=\s+"([^"]*)"/gm)) consts[c[1]!] = c[2]!;
        for (const u of src.matchAll(/func\s+\(\w+\s+\*?(\w+)\)\s+UnmarshalJSON/g)) unmarshalers.add(u[1]!);
    }
    // duration.Duration lives in a subpackage; its UnmarshalJSON takes a string.
    unmarshalers.add('duration.Duration');
    for (const src of sources) {
        parseStructs(src, null, parsed, aliases);
        parseLoaders(src, consts, loaders);
    }
    const protoPaths = Object.keys(PROTO_FILES);
    readFiles(ref, protoPaths).forEach((src, i) => parseStructs(src, PROTO_FILES[protoPaths[i]!]!, parsed, aliases));

    const fieldsOf = (name: string): Record<string, string> => {
        const synthetic = SYNTHETIC[name];
        if (synthetic) {
            const merged: Record<string, string> = {};
            for (const e of synthetic.embeds) Object.assign(merged, fieldsOf(e));
            for (const d of synthetic.drop ?? []) delete merged[d];
            return merged;
        }
        const s = parsed[name];
        if (!s) throw new Error(`${tag}: no struct ${name}`);
        const merged: Record<string, string> = {};
        for (const e of s.embeds) if (parsed[e]) Object.assign(merged, fieldsOf(e));
        return Object.assign(merged, s.fields);
    };

    /** A Go type with pointers dropped and plain aliases resolved. */
    const normalize = (type: string): string => {
        if (type.startsWith('*')) return normalize(type.slice(1));
        if (type.startsWith('[]')) return type === '[]byte' ? '[]byte' : `[]${normalize(type.slice(2))}`;
        const map = /^map\[(\w+)\](.+)$/.exec(type);
        if (map) return `map[${map[1]}]${normalize(map[2]!)}`;
        if (type === 'duration.Duration') return 'Duration';
        if (BASIC.has(type) || type.startsWith('dispatch:') || type.startsWith('opaque:')) return type;
        if (unmarshalers.has(type.replace(/^\w+\./, ''))) return type;
        if (parsed[type] || SYNTHETIC[type]) return type;
        if (aliases[type]) return normalize(aliases[type]!);
        // StringOrNumber / BoolOrNumber from RAW, or a type the test has to know.
        return type;
    };

    const loaderStruct = (name: string): string => {
        const l = loaders[name];
        if (!l) throw new Error(`${tag}: no loader ${name}`);
        // configKey "" — the id and the settings share one object; otherwise the
        // settings sit under configKey and only they come here.
        const synthetic = `${name}<${l.configKey ? l.configKey : 'inline'}>`;
        const merged: Record<string, string> = {};
        if (!l.configKey) merged[l.idKey] = 'string';
        for (const variant of Object.values(l.variants)) Object.assign(merged, fieldsOf(variant));
        parsed[synthetic] = { fields: merged, embeds: [] };
        return synthetic;
    };

    const visited = new Set<string>();
    const walkStruct = (name: string) => {
        if (visited.has(name)) return;
        visited.add(name);
        const fields = fieldsOf(name);
        const out = (structs[name] ??= {});
        for (const [key, goType] of Object.entries(fields)) {
            const id = `${name}.${key}`;
            // A struct from a package not parsed here (proxyman.SniffingConfig)
            // is as unknown to the walk as a raw field, and needs the same entry.
            const bare = goType.replace(/^[*[\]]*/, '');
            const foreign = /^[a-z]\w*\.[A-Z]\w*$/.test(bare) && !BASIC.has(bare) && bare !== 'duration.Duration' && !parsed[bare];
            // RAW speaks only for a tag where the field is raw: blackhole's
            // `response` is a RawMessage on 26.7 and a struct from 26.9.
            const raw = /json\.RawMessage|interface\{\}/.test(goType) || foreign;
            let type = (raw && RAW[id]) || goType;
            if (type.startsWith('loader:')) type = loaderStruct(type.slice(7));
            if (raw && !RAW[id]) unknownRaw.add(`${tag} ${id}: ${goType}`);
            const norm = normalize(type);
            (out[key] ??= {})[tag] = norm;
            if (norm === 'dispatch:inbound' || norm === 'dispatch:outbound') {
                const which = norm.slice(9);
                const l = loaders[`${which}ConfigLoader`]!;
                for (const [protocol, struct] of Object.entries(l.variants)) {
                    (dispatch[which]![protocol] ??= {})[tag] = struct;
                    walkStruct(struct);
                }
                continue;
            }
            for (const ref of norm.match(/[\w.<>]+/g) ?? []) {
                if (parsed[ref] || SYNTHETIC[ref]) walkStruct(ref);
            }
        }
    };
    walkStruct('Config');
    // Reached only through a decoder of its own: FakeDNSConfig unmarshals one
    // pool or a list of them (v26.10.21:infra/conf/fakedns.go:36-48).
    walkStruct('FakeDNSPoolElementConfig');
    // The types with a decoder of their own that this tag's config can reach.
    const reached = new Set<string>();
    for (const keys of Object.values(structs)) {
        for (const perTag of Object.values(keys)) for (const t of perTag[tag]?.match(/[\w.]+/g) ?? []) reached.add(t);
    }
    for (const u of unmarshalers) {
        const name = u === 'duration.Duration' ? 'Duration' : u;
        if (reached.has(name) || visited.has(name)) customUnmarshal.add(name);
    }
};

const versions = readVersions();
const releases = releaseSet(repo, versions);
for (const release of releases) walkTag(release);

if (unknownRaw.size) {
    throw new Error(`raw fields with no entry in RAW — read what the core decodes them into:\n  ${[...unknownRaw].join('\n  ')}`);
}

const TAGS = releases.map(r => r.tag);

/** One type on every tag collapses to a string; otherwise tag → type, absent tags left out. */
const compact = (perTag: PerTag): string | PerTag => {
    const values = Object.values(perTag);
    if (values.length === TAGS.length && values.every(v => v === values[0])) return values[0]!;
    return Object.fromEntries(TAGS.filter(t => t in perTag).map(t => [t, perTag[t]!]));
};

const fixture = {
    $comment: 'Generated by scripts/core-keys.ts from Xray-core tags; do not edit. Read by test/coverage.test.ts and by the JSON Schema build. A key is "Go type" when every tag decodes it as that type, otherwise { tag: type } with the tags that lack it left out.',
    tags: TAGS,
    lines: versions.lines ?? {},
    refs: Object.fromEntries(releases.filter(r => r.ref !== r.tag).map(r => [r.tag, r.ref])),
    customUnmarshalers: [...customUnmarshal].sort(),
    dispatch: Object.fromEntries(Object.entries(dispatch).map(([k, v]) =>
        [k, Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([p, l]) => [p, compact(l)]))])),
    structs: Object.fromEntries(Object.entries(structs).sort(([a], [b]) => a.localeCompare(b)).map(([name, keys]) =>
        [name, Object.fromEntries(Object.entries(keys).map(([k, l]) => [k, compact(l)]))])),
};

writeFileSync(OUT, JSON.stringify(fixture, null, 2) + '\n');
console.log(`${TAGS.length} tags, ${Object.keys(fixture.structs).length} structs, ${Object.values(fixture.structs).reduce((n, s) => n + Object.keys(s).length, 0)} keys → ${OUT}`);
