import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { lint, supportedTags } from '../src/index.js';

const sample = (name: string) => readFileSync(join(import.meta.dir, 'samples', name), 'utf8');
const brief = (text: string, opts?: Parameters<typeof lint>[1]) =>
    lint(text, opts).map(i => `${i.severity} ${i.path.join('/')}`);

describe('lint', () => {
    it('passes the good samples on every tag, comments included', () => {
        for (const name of ['server.jsonc', 'client.json']) {
            expect(lint(sample(name))).toEqual([]);
            for (const tag of supportedTags) expect({ tag, issues: lint(sample(name), { tag }) }).toEqual({ tag, issues: [] });
        }
    });

    it('reports what the bad sample says it should', () => {
        expect(brief(sample('bad.jsonc')).sort()).toEqual([
            'error inbounds/0/settings/clients/0/flow',
            'error routing/balancers/0/strategy/settings/maxRTT',
            'error routing/rules/0/webhook',
            'warning inbounds/0/sniffing/destOverrid',
        ]);
    });

    it('points each issue at the text: the value for an error, the key for an unread key', () => {
        const text = sample('bad.jsonc');
        const issues = lint(text);
        const at = (path: string) => { const i = issues.find(i => i.path.join('/') === path)!; return text.slice(i.from, i.to); };
        expect(at('inbounds/0/settings/clients/0/flow')).toBe('1');
        expect(at('routing/rules/0/webhook')).toBe('"https://hooks.example.com/x"');
        expect(at('inbounds/0/sniffing/destOverrid')).toBe('"destOverrid"');
    });

    it('reports a key the chosen tag does not read, and not on a tag that reads it', () => {
        const text = '{ "env": { "PORT": "443" }, "inbounds": [{ "protocol": "socks", "port": "env:PORT" }] }';
        // EnvConfig arrived after the floor; 26.3 drops the whole block.
        expect(brief(text, { tag: 'v26.3.27' })).toEqual(['warning env']);
        expect(brief(text, { tag: 'v26.7.28' })).toEqual([]);
        expect(brief(text)).toEqual([]);
    });

    it('looks a protocol\'s settings up by its name, on the tag asked about', () => {
        // tun's mtu is one number on every tag but v26.4.13; `foo` is read by none.
        const text = '{ "inbounds": [{ "protocol": "tun", "settings": { "name": "xray0", "mtu": 1500, "foo": 1 } }] }';
        expect(brief(text, { tag: 'v26.10.21' })).toEqual(['warning inbounds/0/settings/foo']);
    });

    it('leaves a key in the schema on purpose alone, though no tag reads it', () => {
        expect(lint('{ "routing": { "rules": [{ "type": "field", "outboundTag": "direct" }] } }', { tag: 'v26.10.21' })).toEqual([]);
    });

    it('checks one section by mode', () => {
        expect(brief('[{ "protocol": "vless", "settings": { "vnext": [] }, "mux": { "enabled": "yes" } }]', { mode: 'outbounds' }))
            .toEqual(['error 0/mux/enabled']);
        expect(lint('{ "tag": "b", "selector": "a,b" }', { mode: 'balancer' })).toEqual([]);
        expect(lint('{ "anything": 1 }', { mode: 'none' })).toEqual([]);
    });

    it('reads past a trailing comma and reports it, since Xray refuses one', () => {
        const text = '{ "log": { "loglevel": "warning", }, "inbounds": [], }';
        const issues = lint(text);
        expect(issues.map(i => [i.severity, text.slice(i.from, i.to)])).toEqual([['error', ','], ['error', ',']]);
        expect(issues.map(i => i.from)).toEqual([32, 51]);
        expect(lint(text, { allowTrailingCommas: true })).toEqual([]);
    });

    it('reports a syntax error with its offset', () => {
        const [issue] = lint('{ "log": { "loglevel": "warning" ');
        expect(issue?.severity).toBe('error');
        expect(issue?.message).toStartWith('syntax:');
        expect(issue?.from).toBe(33);
    });

    it('refuses a tag it does not know', () => {
        expect(() => lint('{}', { tag: 'v1.8.24' })).toThrow(RangeError);
    });
});
