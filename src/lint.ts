/**
 * Checks a config's text against the schemas.
 *
 * Ported from the Xray Config UI Editor's `core/xray/json-lint.ts`, which
 * explains why the zod schemas and not a schema generated from Go structs:
 * a routing rule, for instance, is unmarshalled by hand in Go, so the
 * generated definition knows only `ruleTag`, `outboundTag` and `balancerTag`
 * and, with `additionalProperties: false`, marks every real rule invalid.
 * Here every object is open, as it is to the core.
 *
 * Two kinds of finding:
 * - `error`: a value of a type or shape the core cannot load — zod's verdict;
 * - `warning`: a key the core will silently ignore — one the chosen tag (or,
 *   without a tag, every supported tag) has no field for. A typo in a key is
 *   the commonest way a config "does nothing"; the core never says so.
 */
import { z } from 'zod';
import { parseJsonc, type Path } from './jsonc.js';
import {
    BalancerSchema,
    DnsSchema,
    InboundSchema,
    OutboundSchema,
    ReverseSchema,
    RoutingRuleSchema,
    RoutingSchema,
    XrayConfigSchema,
} from './schemas/index.js';
import { inboundSettingsSchemaFor, outboundSettingsSchemaFor } from './schemas/settings-by-protocol.js';
import { fixture, pairing, tagsOf, unwrap } from './walk.js';

export type LintMode =
    | 'full' | 'inbound' | 'inbounds' | 'outbound' | 'outbounds'
    | 'rule' | 'dns' | 'balancer' | 'routing' | 'reverse'
    /** A fragment with no section of its own: syntax is checked, shape is not. */
    | 'none';

export interface LintOptions {
    /** What the text is: a whole config (the default) or one section of it. */
    mode?: LintMode;
    /** An Xray-core release tag (`v26.7.28`): keys it does not read are reported. */
    tag?: string;
    /**
     * Xray's loader takes comments but not trailing commas: by default each
     * one is an error. `true` for text that a tool cleans up before Xray sees it.
     */
    allowTrailingCommas?: boolean;
}

export interface LintIssue {
    /** Where the problem is, as a path of keys and array indexes. */
    path: Path;
    /** One sentence, addressed to whoever is looking at the config. */
    message: string;
    severity: 'error' | 'warning';
    /** Offsets into the text to underline (a key for an unread key, else the value). */
    from?: number;
    to?: number;
}

const SCHEMAS: Record<LintMode, z.ZodType> = {
    none: z.unknown(),
    full: XrayConfigSchema,
    inbound: InboundSchema,
    inbounds: z.array(InboundSchema),
    outbound: OutboundSchema,
    outbounds: z.array(OutboundSchema),
    rule: RoutingRuleSchema,
    routing: RoutingSchema,
    dns: DnsSchema,
    balancer: BalancerSchema,
    reverse: ReverseSchema,
};

export const schemaFor = (mode: LintMode): z.ZodType => SCHEMAS[mode] ?? XrayConfigSchema;

/** `['routing', 'rules', 0, 'port']` -> `routing.rules[0].port`. */
export const formatPath = (path: Path): string =>
    path.reduce<string>((out, segment) => (
        typeof segment === 'number' ? `${out}[${segment}]` : out ? `${out}.${segment}` : String(segment)
    ), '');

const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

/**
 * Says what is wrong in the terms of the config in front of the reader: zod's
 * own wording ("Invalid input: expected string, received number") is aimed at
 * a developer reading a stack trace.
 */
const describe = (issue: z.core.$ZodIssue, path: Path): string => {
    const where = formatPath(path);
    const field = where ? `${where}: ` : '';
    const any = issue as any;

    switch (issue.code) {
        case 'invalid_type': {
            const expected = String(any.expected ?? 'a different type');
            return `${field}expected ${article(expected)} ${expected}`;
        }
        case 'invalid_value': {
            const values = any.values as unknown[] | undefined;
            if (values?.length) return `${field}must be one of ${values.map(v => JSON.stringify(v)).join(', ')}`;
            return `${field}${issue.message}`;
        }
        case 'unrecognized_keys': {
            const keys = (any.keys as string[] | undefined) ?? [];
            return `${field}unknown ${keys.length === 1 ? 'key' : 'keys'}: ${keys.join(', ')}`;
        }
        case 'invalid_union':
            return `${field}does not match any of the shapes this field accepts`;
        default:
            return `${field}${issue.message}`;
    }
};

type Found = Omit<LintIssue, 'from' | 'to'>;

/**
 * The `settings` block, checked against the protocol beside it. The wrapper
 * schemas leave `settings` open — it means something different for every
 * protocol — so the shape is looked up by `protocol`.
 */
const settingsIssues = (mode: LintMode, value: unknown): Found[] => {
    const issues: Found[] = [];
    const check = (node: unknown, at: Path, pick: (protocol: unknown) => z.ZodType | null) => {
        if (!node || typeof node !== 'object') return;
        const entry = node as { protocol?: unknown; settings?: unknown };
        if (entry.settings === undefined || entry.settings === null) return;
        const schema = pick(entry.protocol);
        if (!schema) return;
        const result = schema.safeParse(entry.settings);
        if (result.success) return;
        for (const issue of result.error.issues) {
            const path = [...at, 'settings', ...(issue.path as Path)];
            issues.push({ path, message: describe(issue, path), severity: 'error' });
        }
    };
    const eachOf = (list: unknown, at: Path, pick: (p: unknown) => z.ZodType | null) => {
        if (Array.isArray(list)) list.forEach((entry, index) => check(entry, [...at, index], pick));
    };

    switch (mode) {
        case 'inbound': check(value, [], inboundSettingsSchemaFor); break;
        case 'outbound': check(value, [], outboundSettingsSchemaFor); break;
        case 'inbounds': eachOf(value, [], inboundSettingsSchemaFor); break;
        case 'outbounds': eachOf(value, [], outboundSettingsSchemaFor); break;
        case 'full': {
            const config = (value ?? {}) as { inbounds?: unknown; outbounds?: unknown };
            eachOf(config.inbounds, ['inbounds'], inboundSettingsSchemaFor);
            eachOf(config.outbounds, ['outbounds'], outboundSettingsSchemaFor);
            break;
        }
        default: break;
    }
    return issues;
};

// --- Keys the core will ignore ------------------------------------------------

type Any = any;
const kind = (s: Any): string => s?._def?.type ?? '';
const branches = (s: Any): Any[] => {
    const bare = unwrap(s);
    return kind(bare) === 'union' ? (bare._def.options as Any[]).flatMap(branches) : [bare];
};
const shape = (o: Any): Record<string, Any> => o.shape ?? {};
const lookup = (keys: Record<string, unknown>, key: string): string | undefined =>
    key in keys ? key : Object.keys(keys).find(k => k.toLowerCase() === key.toLowerCase());

/**
 * Walks the value beside the schema and reports each key no struct behind the
 * object decodes on `tag`. A key the schema declares but no tag reads (a
 * rule's `"type": "field"`) is left alone: it is in the schema on purpose,
 * and every published config writes it. An object the coverage walk never
 * paired with a struct is skipped — nothing is known about its keys.
 */
const unreadKeys = (schema: z.ZodType, value: unknown, tag: string | undefined): Found[] => {
    const paired = pairing();
    const found: Found[] = [];
    const isRead = (structs: string[], key: string, at: string | undefined) => structs.some(struct => {
        const keys = fixture.structs[struct] ?? {};
        const goKey = lookup(keys, key);
        return goKey !== undefined && (!at || tagsOf(keys[goKey]!).includes(at));
    });

    const visit = (s: Any, v: unknown, path: Path) => {
        if (v === null || typeof v !== 'object') return;
        const options = branches(s);
        if (Array.isArray(v)) {
            const arrays = options.filter(o => kind(o) === 'array');
            if (arrays.length === 1) v.forEach((item, i) => visit(arrays[0]._def.element, item, [...path, i]));
            return;
        }
        const objects = options.filter(o => kind(o) === 'object');
        const entries = Object.entries(v as Record<string, unknown>);
        if (!objects.length) {
            const records = options.filter(o => kind(o) === 'record');
            if (records.length === 1) for (const [k, item] of entries) visit(records[0]._def.valueType, item, [...path, k]);
            return;
        }
        const pairs = objects.map(o => paired.get(o));
        const known = pairs.every(Boolean);
        const structs = pairs.flatMap(p => p?.structs ?? []);
        for (const [key, item] of entries) {
            const owner = objects.find(o => lookup(shape(o), key) !== undefined);
            if (known && !isRead(structs, key, tag)) {
                // In the schema but read by no tag at all: documented on purpose.
                const readSomewhere = isRead(structs, key, undefined);
                if (!owner || readSomewhere) {
                    const where = formatPath([...path, key]);
                    found.push({
                        path: [...path, key],
                        severity: 'warning',
                        message: tag
                            ? `${where}: Xray-core ${tag} does not read this key; the core ignores it`
                            : `${where}: no supported Xray-core release reads this key; the core ignores it`,
                    });
                }
            }
            if (!owner) continue;
            let child: Any = shape(owner)[lookup(shape(owner), key)!];
            // `settings` is open in the wrapper and means what `protocol` says.
            if (key === 'settings' && (owner === InboundSchema || owner === OutboundSchema)) {
                const protocol = (v as { protocol?: unknown }).protocol;
                child = (owner === InboundSchema ? inboundSettingsSchemaFor : outboundSettingsSchemaFor)(protocol);
                if (!child) continue;
            }
            visit(child, item, [...path, key]);
        }
    };
    visit(schema, value, []);
    return found;
};

/** The tags a lint can be asked about. */
const assertTag = (tag: string | undefined) => {
    if (tag !== undefined && !fixture.tags.includes(tag)) {
        throw new RangeError(`xray-schema: ${tag} is not a supported tag (${fixture.tags.join(', ')})`);
    }
};

/**
 * Validates an already-parsed value. At most one issue per path: zod reports
 * every branch of a union it tried, and a field wrong in six ways is still one
 * thing to fix.
 */
export const lintValue = (value: unknown, opts: LintOptions = {}): Found[] => {
    const mode = opts.mode ?? 'full';
    assertTag(opts.tag);
    const found: Found[] = [];
    const result = schemaFor(mode).safeParse(value);
    if (!result.success) {
        for (const issue of result.error.issues) {
            const path = issue.path as Path;
            found.push({ path, message: describe(issue, path), severity: 'error' });
        }
    }
    found.push(...settingsIssues(mode, value));
    if (mode !== 'none') found.push(...unreadKeys(schemaFor(mode), value, opts.tag));

    const seen = new Set<string>();
    return found.filter(issue => {
        const key = `${issue.severity} ${formatPath(issue.path)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

/**
 * Checks a config's text: syntax first (comments are fine, trailing commas
 * are read past and reported), then the schema. Each issue carries the
 * offsets to underline.
 */
export const lint = (json: string, opts: LintOptions = {}): LintIssue[] => {
    assertTag(opts.tag);
    const parsed = parseJsonc(json);
    if (parsed.error) {
        const { message, offset } = parsed.error;
        return [{ path: [], message: `syntax: ${message}`, severity: 'error', from: offset, to: Math.min(offset + 1, json.length) }];
    }
    const commas: LintIssue[] = opts.allowTrailingCommas ? [] : parsed.trailingCommas.map(offset => ({
        path: [], severity: 'error', from: offset, to: offset + 1,
        message: "syntax: a trailing comma — Xray-core's loader refuses it (comments are fine)",
    }));
    return [...commas, ...lintValue(parsed.value, opts).map(issue => {
        // A path zod reports may end below what the text has (a missing key): underline its parent.
        let span;
        for (let n = issue.path.length; n >= 0 && !span; n--) span = parsed.locate(issue.path.slice(0, n));
        const at = issue.severity === 'warning' && span?.key ? span.key : span;
        return at ? { ...issue, from: at.from, to: at.to } : issue;
    })];
};
