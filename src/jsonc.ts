/**
 * A small JSONC reader: JSON plus `//` and `/* *\/` comments and trailing
 * commas — what Xray itself accepts (its loader strips comments) and what
 * people keep their configs in.
 *
 * It also remembers where every value sits, so a finding at
 * `routing.rules[0].port` can be underlined in the text it came from. That is
 * the reason it exists instead of a dependency: a strip-then-JSON.parse
 * reader would lose the offsets.
 */

export type Path = (string | number)[];

export interface Span {
    /** Offset of the value's first character. */
    from: number;
    /** Offset just past its last character. */
    to: number;
    /** For an object member: where its key is. */
    key?: { from: number; to: number };
}

export interface JsoncResult {
    value: unknown;
    /** The first syntax error, if any; `value` is then undefined. */
    error?: { message: string; offset: number };
    /** Offsets of commas before a closing `}` or `]`. */
    trailingCommas: number[];
    /** Where the value at a path is, or undefined for a path the text does not have. */
    locate(path: Path): Span | undefined;
}

class SyntaxProblem extends Error {
    constructor(message: string, readonly offset: number) { super(message); }
}

const spanKey = (path: Path) => JSON.stringify(path);

export const parseJsonc = (text: string): JsoncResult => {
    const spans = new Map<string, Span>();
    const trailingCommas: number[] = [];
    let i = 0;

    const fail = (message: string, at = i): never => { throw new SyntaxProblem(message, at); };

    const skip = () => {
        for (;;) {
            const c = text[i];
            if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '﻿') { i++; continue; }
            if (c === '#' || (c === '/' && text[i + 1] === '/')) {
                while (i < text.length && text[i] !== '\n') i++;
                continue;
            }
            if (c === '/' && text[i + 1] === '*') {
                const end = text.indexOf('*/', i + 2);
                if (end < 0) fail('unterminated comment');
                i = end + 2;
                continue;
            }
            return;
        }
    };

    const string = (): string => {
        const start = i;
        i++; // opening quote
        while (i < text.length) {
            const c = text[i];
            if (c === '"') {
                i++;
                try {
                    return JSON.parse(text.slice(start, i)) as string;
                } catch {
                    return fail('invalid escape in string', start);
                }
            }
            if (c === '\\') i += 2;
            else if (c === '\n') fail('unterminated string', start);
            else i++;
        }
        return fail('unterminated string', start);
    };

    const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

    const value = (path: Path): unknown => {
        skip();
        const from = i;
        const c = text[i];
        let out: unknown;
        if (c === '{') {
            i++;
            const obj: Record<string, unknown> = {};
            skip();
            while (text[i] !== '}') {
                if (text[i] !== '"') fail(i >= text.length ? 'unexpected end of input' : 'expected a key in double quotes');
                const keyFrom = i;
                const key = string();
                const keyTo = i;
                skip();
                if (text[i] !== ':') fail('expected ":" after a key');
                i++;
                obj[key] = value([...path, key]);
                const span = spans.get(spanKey([...path, key]));
                if (span) span.key = { from: keyFrom, to: keyTo };
                skip();
                if (text[i] === ',') { const comma = i++; skip(); if (text[i] === '}') trailingCommas.push(comma); continue; }
                if (text[i] !== '}') fail(i >= text.length ? 'unexpected end of input' : 'expected "," or "}"');
            }
            i++;
            out = obj;
        } else if (c === '[') {
            i++;
            const arr: unknown[] = [];
            skip();
            while (text[i] !== ']') {
                if (i >= text.length) fail('unexpected end of input');
                arr.push(value([...path, arr.length]));
                skip();
                if (text[i] === ',') { const comma = i++; skip(); if (text[i] === ']') trailingCommas.push(comma); continue; }
                if (text[i] !== ']') fail(i >= text.length ? 'unexpected end of input' : 'expected "," or "]"');
            }
            i++;
            out = arr;
        } else if (c === '"') {
            out = string();
        } else if (text.startsWith('true', i)) { i += 4; out = true; }
        else if (text.startsWith('false', i)) { i += 5; out = false; }
        else if (text.startsWith('null', i)) { i += 4; out = null; }
        else {
            NUMBER.lastIndex = i;
            const m = NUMBER.exec(text);
            if (!m) fail(i >= text.length ? 'unexpected end of input' : `unexpected character ${JSON.stringify(c)}`);
            i += m![0].length;
            out = Number(m![0]);
        }
        spans.set(spanKey(path), { from, to: i });
        return out;
    };

    const locate = (path: Path) => spans.get(spanKey(path));
    try {
        const result = value([]);
        skip();
        if (i < text.length) fail('unexpected text after the value');
        return { value: result, trailingCommas, locate };
    } catch (e) {
        if (e instanceof SyntaxProblem) return { value: undefined, error: { message: e.message, offset: e.offset }, trailingCommas, locate };
        throw e;
    }
};
