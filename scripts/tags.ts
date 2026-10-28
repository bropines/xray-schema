/**
 * The release set, from `versions.json` and a clone's tags: every `vX.Y.Z`
 * tag at or above `floor`, plus each `extra` entry (`tag@commit`, a tag that
 * was deleted upstream and is read from its release commit).
 *
 * Tags, not GitHub releases: Xray-core tags exactly what it releases, and a
 * clone is all the generator needs — no API token, no rate limit.
 */
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

export interface VersionsFile {
    floor: string;
    extra?: string[];
    lines?: Record<string, string>;
}

export const ROOT = join(import.meta.dir, '..');

export const readVersions = (): VersionsFile =>
    JSON.parse(readFileSync(join(ROOT, 'versions.json'), 'utf8')) as VersionsFile;

const parts = (tag: string): number[] => {
    const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag);
    if (!m) throw new Error(`not a release tag: ${tag}`);
    return [Number(m[1]), Number(m[2]), Number(m[3])];
};

export const isReleaseTag = (tag: string) => /^v\d+\.\d+\.\d+$/.test(tag);

export const compareTags = (a: string, b: string): number => {
    const [x, y] = [parts(a), parts(b)];
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
    return 0;
};

export interface Release { tag: string; ref: string }

/** Resolves a short commit to the full hash, so the fixture names it exactly. */
const resolve = (repo: string, rev: string) =>
    execFileSync('git', ['rev-parse', '--verify', `${rev}^{commit}`], { cwd: repo, encoding: 'utf8' }).trim();

export const releaseSet = (repo: string, versions = readVersions()): Release[] => {
    const tags = execFileSync('git', ['tag', '-l'], { cwd: repo, encoding: 'utf8' })
        .split('\n').map(t => t.trim()).filter(isReleaseTag)
        .filter(t => compareTags(t, versions.floor) >= 0);
    const out = new Map<string, Release>(tags.map(tag => [tag, { tag, ref: tag }]));
    for (const entry of versions.extra ?? []) {
        const [tag, commit] = entry.split('@');
        if (!tag || !commit || !isReleaseTag(tag)) throw new Error(`versions.json extra: expected tag@commit, got ${entry}`);
        // The commit wins even if the tag came back: the entry says which tree was released.
        out.set(tag, { tag, ref: resolve(repo, commit) });
    }
    return [...out.values()].sort((a, b) => compareTags(a.tag, b.tag));
};
