/**
 * What each supported tag decodes, read from the fixture the coverage test
 * holds the schemas to (`src/core-keys.json`, generated from the tags'
 * `infra/conf`).
 */
import { fixture, tagsOf } from './walk.js';

/** Every Xray-core release tag the schemas are held to, oldest first. */
export const supportedTags: readonly string[] = Object.freeze([...fixture.tags]);

/**
 * The Xray Config UI Editor's names for runs of tags, each naming the tag it
 * reads (`"26.7": "v26.7.28"`). A grouping only; nothing here is per line.
 */
export const lines: Readonly<Record<string, string>> = Object.freeze({ ...fixture.lines });

export interface TagKeys {
    /** Go struct → JSON key → Go type, for every struct the root `Config` reaches on this tag. */
    structs: Record<string, Record<string, string>>;
    /** Protocol → the struct its `settings` is decoded into, per direction. */
    protocols: { inbound: Record<string, string>; outbound: Record<string, string> };
}

const at = (perTag: string | Record<string, string>, tag: string): string | undefined =>
    typeof perTag === 'string' ? perTag : perTag[tag];

/** The keys and Go types `tag` decodes. Throws for a tag outside `supportedTags`. */
export const keysFor = (tag: string): TagKeys => {
    if (!fixture.tags.includes(tag)) {
        throw new RangeError(`xray-schema: ${tag} is not a supported tag (${fixture.tags.join(', ')})`);
    }
    const structs: TagKeys['structs'] = {};
    for (const [name, keys] of Object.entries(fixture.structs)) {
        const here = Object.entries(keys).filter(([, v]) => tagsOf(v).includes(tag));
        if (here.length) structs[name] = Object.fromEntries(here.map(([k, v]) => [k, at(v, tag)!]));
    }
    const protocols = { inbound: {}, outbound: {} } as TagKeys['protocols'];
    for (const direction of ['inbound', 'outbound'] as const) {
        for (const [protocol, v] of Object.entries(fixture.dispatch[direction])) {
            const struct = at(v, tag);
            if (struct) protocols[direction][protocol] = struct;
        }
    }
    return { structs, protocols };
};
