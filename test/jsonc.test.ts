import { describe, expect, it } from 'bun:test';
import { parseJsonc } from '../src/jsonc.js';

describe('parseJsonc', () => {
    it('reads what JSON.parse reads', () => {
        const text = String.raw`{"a":[1,-2.5e3,"x\n\u0041",true,false,null],"b":{}}`;
        expect(parseJsonc(text).value).toEqual(JSON.parse(text));
    });

    it('takes comments and trailing commas', () => {
        const r = parseJsonc('// head\n{ /* inline */ "a": [1, 2,], // tail\n "b": "//not a comment", }\n');
        expect(r.error).toBeUndefined();
        expect(r.value).toEqual({ a: [1, 2], b: '//not a comment' });
    });

    it('knows where each value and key is', () => {
        const text = '{\n  "routing": { "rules": [ { "port": 53 } ] }\n}';
        const r = parseJsonc(text);
        const span = r.locate(['routing', 'rules', 0, 'port'])!;
        expect(text.slice(span.from, span.to)).toBe('53');
        expect(text.slice(span.key!.from, span.key!.to)).toBe('"port"');
        expect(r.locate(['routing', 'nope'])).toBeUndefined();
    });

    it('reports the first syntax error and where it is', () => {
        for (const [text, offset] of [['{"a" 1}', 5], ['[1 2]', 3], ['{"a": tru}', 6], ['/* open', 0], ['', 0], ['{} x', 3]] as const) {
            const r = parseJsonc(text);
            expect({ text, offset: r.error?.offset }).toEqual({ text, offset });
            expect(r.value).toBeUndefined();
        }
    });
});
