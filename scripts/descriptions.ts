/**
 * The JSDoc on each key of a zod object, as JSON Schema `description`s.
 *
 * The schemas carry their documentation as comments, not `.describe()`
 * calls, and that is kept: a comment is free at runtime and the files stay
 * line-for-line comparable with the editor's. This reads the comments back
 * with the TypeScript parser and pins each one to the runtime zod object it
 * documents, by following the key path from the exported constant it is
 * written under (`XrayConfigSchema` → `version` → `min`). A key under a
 * constant nobody exports is not reachable that way and gets no description.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import ts from 'typescript';
import { unwrap } from '../src/walk.js';
import { ROOT } from './tags.js';

export interface KeyDoc { description: string; deprecated: boolean }

const SCHEMAS = join(ROOT, 'src/schemas');

const filesUnder = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : name.endsWith('.ts') ? [path] : [];
});

/**
 * Sentences about the editor these files were ported from — its modules, its
 * forms — say nothing to someone reading a hover in their own editor.
 */
const EDITOR_ONLY = /core\/xray|components\/|\bthe (?:JSON )?editor\b|\bthe form\b|\bforms?\b(?! of)|\bthis app\b|Editor\b|VALUE_SETS|feature table|\.test\.ts/i;

const clean = (text: string): string => text
    .replace(/\s*\n\s*/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z`(“"])/)
    .filter(sentence => !EDITOR_ONLY.test(sentence))
    .join(' ')
    .trim();

const docOf = (node: ts.Node): KeyDoc | null => {
    const docs = ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc);
    if (!docs.length) return null;
    const doc = docs[docs.length - 1]!;
    const description = clean(ts.getTextOfJSDocComment(doc.comment) ?? '');
    const deprecated = (doc.tags ?? []).some(t => t.tagName.text === 'deprecated');
    return description || deprecated ? { description, deprecated } : null;
};

/** `z.object({…})` → its literal; anything else → null. Chained calls (`.passthrough()`) are looked through. */
const objectLiteralsIn = (expr: ts.Node, path: string[], out: { path: string[]; literal: ts.ObjectLiteralExpression }[]) => {
    if (ts.isCallExpression(expr)) {
        const callee = expr.expression;
        if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'object' && ts.isIdentifier(callee.expression) && callee.expression.text === 'z') {
            const arg = expr.arguments[0];
            if (arg && ts.isObjectLiteralExpression(arg)) out.push({ path, literal: arg });
            return;
        }
        // z.union([…]) / z.array(…) / x.optional() — the objects inside keep the key path.
        objectLiteralsIn(callee, path, out);
        for (const arg of expr.arguments) objectLiteralsIn(arg, path, out);
        return;
    }
    if (ts.isPropertyAccessExpression(expr)) return objectLiteralsIn(expr.expression, path, out);
    if (ts.isArrayLiteralExpression(expr)) for (const e of expr.elements) objectLiteralsIn(e, path, out);
};

const keyName = (p: ts.ObjectLiteralElementLike): string | null =>
    p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null;

type Any = any;
const shapeOf = (s: Any): Record<string, Any> | null => {
    const bare = unwrap(s);
    return bare?.shape ?? null;
};

/** Every zod object a schema may be at a key path: unions and arrays are looked into. */
const objectsAt = (schema: Any, path: string[]): object[] => {
    const here = (s: Any): object[] => {
        const bare = unwrap(s);
        const type = bare?._def?.type;
        if (type === 'object') return [bare];
        if (type === 'union') return (bare._def.options as Any[]).flatMap(here);
        if (type === 'array') return here(bare._def.element);
        if (type === 'record') return here(bare._def.valueType);
        return [];
    };
    let current = here(schema);
    for (const key of path) current = current.flatMap(o => { const v = shapeOf(o)?.[key]; return v ? here(v) : []; });
    return current;
};

/** zod object → key → its documentation. */
export const keyDocs = async (): Promise<Map<object, Record<string, KeyDoc>>> => {
    const docs = new Map<object, Record<string, KeyDoc>>();
    for (const file of filesUnder(SCHEMAS)) {
        const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
        const module = await import(file) as Record<string, unknown>;
        const visit = (node: ts.Node) => {
            if (ts.isVariableStatement(node)) {
                for (const decl of node.declarationList.declarations) {
                    if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
                    const root = module[decl.name.text];
                    if (!root) continue; // not exported
                    const walkLiterals = (expr: ts.Node, path: string[]) => {
                        const found: { path: string[]; literal: ts.ObjectLiteralExpression }[] = [];
                        objectLiteralsIn(expr, path, found);
                        for (const { path: at, literal } of found) {
                            const targets = objectsAt(root, at).filter(o => {
                                const keys = Object.keys(shapeOf(o) ?? {});
                                // The object the literal built has exactly its keys.
                                return literal.properties.every(p => { const name = keyName(p); return name === null || keys.includes(name); });
                            });
                            for (const prop of literal.properties) {
                                const key = keyName(prop);
                                if (key === null || !ts.isPropertyAssignment(prop)) continue;
                                const doc = docOf(prop);
                                if (doc) for (const t of targets) (docs.get(t) ?? docs.set(t, {}).get(t)!)[key] = doc;
                                walkLiterals(prop.initializer, [...at, key]);
                            }
                        }
                    };
                    walkLiterals(decl.initializer, []);
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
        if (!source.statements.length) throw new Error(`empty schema file ${relative(ROOT, file)}`);
    }
    return docs;
};
