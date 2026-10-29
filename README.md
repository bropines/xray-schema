# xray-schema

Hand-written [zod](https://zod.dev) schemas for [Xray-core](https://github.com/XTLS/Xray-core) configs, held by a test to exactly what each Xray release decodes, from v26.3.27 up. From them come JSON Schemas — one for every release and one for all of them — that any editor can use: VS Code through `$schema`, Monaco, CodeMirror.

[Русская версия](README.ru.md)

- [Use it](#use-it): [VS Code](#vs-code) · [Monaco](#monaco) · [CodeMirror](#codemirror) · [zod](#zod) · [`lint()`](#lint) · [`keysFor()`](#keysfor)
- [Why hand-written zod](#why-hand-written-zod-and-not-a-schema-generated-from-go)
- [How coverage keeps it honest](#how-coverage-keeps-it-honest)
- [Supported releases](#supported-releases) · [Adding a release](#adding-a-new-xray-release)
- [Limits](#limits) · [Development](#development) · [License](#license)

## Use it

> Not on the npm registry yet: install the tarball attached to each GitHub release, or use the JSON Schema files straight from jsDelivr.

There are two kinds of file in [`schema/`](schema/):

| File | Holds |
| --- | --- |
| `schema/xray.schema.json` | every key any supported release reads |
| `schema/<tag>.schema.json` (`v26.7.28.schema.json`, …) | only the keys that release reads |

Pick the file for the core your config runs on. Objects are always open (`additionalProperties` allowed): Xray drops a key it has no field for without a word, so an unknown key is not an error to the core and is not one here. `lint()` is what tells you about it.

### VS Code

Put `$schema` at the top of the config. Xray ignores the key — `Config` has no such field.

```jsonc
{
  "$schema": "https://cdn.jsdelivr.net/gh/bropines/xray-schema@v0.1.0/schema/v26.10.21.schema.json",
  "log": { "loglevel": "warning" }
}
```

Or map files to it in `settings.json`, and leave the configs alone:

```jsonc
"json.schemas": [
  {
    "fileMatch": ["**/xray/*.json", "**/xray/*.jsonc"],
    "url": "https://cdn.jsdelivr.net/gh/bropines/xray-schema@v0.1.0/schema/xray.schema.json"
  }
]
```

Every key the schemas document shows its description on hover, with the source line in Xray-core it was read from.

### Monaco

```ts
import * as monaco from 'monaco-editor';
import schema from 'xray-schema/schema/v26.10.21.schema.json' with { type: 'json' };

monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
  validate: true,
  allowComments: true,
  schemas: [{ uri: 'https://xray-schema/v26.10.21.schema.json', fileMatch: ['*'], schema }],
});
```

### CodeMirror

`lint()` returns offsets, so it plugs straight into `@codemirror/lint`, comments included:

```ts
import { linter } from '@codemirror/lint';
import { lint } from 'xray-schema';

const xrayLint = linter(view =>
  lint(view.state.doc.toString(), { tag: 'v26.10.21' })
    .map(({ from = 0, to = from, severity, message }) => ({ from, to, severity, message })));
```

For completion from the JSON Schema, any JSON Schema extension works, e.g. [`codemirror-json-schema`](https://www.npmjs.com/package/codemirror-json-schema): `jsonSchema(schema)` with a file from `xray-schema/schema/`.

### zod

```sh
npm install https://github.com/bropines/xray-schema/releases/download/v0.1.0/xray-schema-0.1.0.tgz zod   # zod 4 is a peer dependency
```

```ts
import {
  XrayConfigSchema, InboundSchema, OutboundSchema, RoutingSchema, RoutingRuleSchema,
  BalancerSchema, DnsSchema, ReverseSchema,
  inboundSettingsSchemaFor, outboundSettingsSchemaFor,
  StringListSchema, DurationStringSchema, PortSchema,
} from 'xray-schema';

const config = XrayConfigSchema.parse(JSON.parse(text));

// `settings` means something different for every protocol, so the wrappers leave
// it open; look its schema up by the protocol beside it.
const settings = inboundSettingsSchemaFor(config.inbounds?.[0]?.protocol);
settings?.parse(config.inbounds?.[0]?.settings);
```

The primitives are the core's own shapes: a `StringList` is an array or one string the core splits on `,` (`StringListSchema`, `commaList()`); a `duration.Duration` is a string, never a number (`DurationStringSchema`); a `PortList` or an `Int32Range` is a number or a string.

### `lint()`

```ts
import { lint } from 'xray-schema';

lint(text);                                   // a whole config, any supported release
lint(text, { tag: 'v26.3.27' });              // …as that release reads it
lint(text, { mode: 'outbounds' });            // one section: inbound(s), outbound(s), rule,
                                              // routing, dns, balancer, reverse, none
// → [{ path: ['routing', 'rules', 0, 'outbountTag'], severity: 'warning', from, to,
//      message: 'routing.rules[0].outbountTag: Xray-core v26.3.27 does not read this key; the core ignores it' }]
```

- `error`: a type or shape the core cannot decode — a string where it wants an object, a number for a duration;
- `warning`: a key the core will silently ignore, on the tag you name (or on every supported tag). A typo in a key is the commonest way a config does nothing, and the core never says so.

The text may carry `//`, `#` and `/* */` comments — Xray's own loader strips them. A trailing comma is read past, so the rest of the file is still checked, and reported as an error, because Xray refuses it; pass `allowTrailingCommas: true` for text a tool cleans before Xray sees it. `from`/`to` are offsets into the text: the value for an error, the key for an unread key. `lintValue(value, opts)` takes an already-parsed value, `parseJsonc(text)` is the reader on its own.

### `keysFor()`

```ts
import { keysFor, supportedTags } from 'xray-schema';

supportedTags;                                 // ['v26.3.27', …, 'v26.10.21']
keysFor('v26.9.30').structs.MasqueConfig;      // { host: 'string', path: 'string', … }
keysFor('v26.9.30').protocols.inbound.masque;  // 'MasqueServerConfig'
```

The per-tag table itself is `xray-schema/core-keys.json`.

## Why hand-written zod and not a schema generated from Go

The obvious way to get a schema is to walk Xray's Go structs. It is wrong in exactly the places that matter, because a good part of a config is not decoded by struct tags at all. A routing rule is the clearest case: Xray unmarshals it by hand (`parseFieldRule`), so the struct a generator sees, `RouterRule`, has three fields — `ruleTag`, `outboundTag`, `balancerTag`. A generated schema then knows only those three and, with `additionalProperties: false`, marks every real rule invalid for `domain`, `ip`, `port` and the rest — on configs that run perfectly well.

The same happens wherever the core does the decoding itself: `settings` turns into a different struct for every protocol; a `StringList` takes an array or a comma-separated string; a fallback's `dest` is a port number or an address; `tcpFastOpen` is a bool or a number; a duration is a string and a number fails the whole document. These schemas are written to say what the core actually accepts, and a test — not trust — keeps them to it.

## How coverage keeps it honest

`scripts/core-keys.ts` reads every release tag's own `infra/conf` (through `git cat-file`; it never checks anything out) and writes [`src/core-keys.json`](src/core-keys.json): every struct the root `Config` reaches, each key with its Go type **on each tag**, and which struct each protocol's `settings` becomes on each tag. Where the core decodes a `json.RawMessage` or an `interface{}` itself, what it becomes is code, not a struct tag — so it is written down by hand in the script's `RAW` table, with the source line that does it. A raw field the walk meets that `RAW` does not name stops the script.

[`test/coverage.test.ts`](test/coverage.test.ts) walks the zod schemas beside those structs and fails on:

- a key some tag decodes that has no zod counterpart;
- a zod type the core cannot decode (or one that lets through a shape the core refuses);
- a zod key no tag reads;

unless an `ALLOWED` entry says why the gap is there on purpose — a key every release refuses at load, a field the loader sets itself, a key that is client-only in a shared struct. An `ALLOWED` entry that no longer matches a gap fails too, so the list only shrinks.

The same pairing of zod objects with structs is what builds the per-tag JSON Schemas: a key leaves `properties` on a tag none of the structs behind its object decodes it on. An object the walk could not pair with a struct (a finalmask layer's settings, decoded per mask type) is kept whole: nothing is known about it, so nothing is dropped.

## Supported releases

Every Xray-core release from **v26.3.27** up, stable and prerelease alike — the set [`versions.json`](versions.json) describes, the same rule [xray-wasm](https://github.com/bropines/xray-wasm) uses. *Keys* is how many struct keys the tag decodes; almost every release differs from the one before, which is why the files are per tag. *Line* is the Xray Config UI Editor's name for a group of tags, a label only.

| Tag | Released | Keys | Schema | Line |
| --- | --- | ---: | --- | --- |
| v26.3.27 | 2026-03-27 | 582 | [`v26.3.27.schema.json`](schema/v26.3.27.schema.json) | 26.3 |
| v26.4.13 | 2026-04-13, prerelease | 587 | [`v26.4.13.schema.json`](schema/v26.4.13.schema.json) | |
| v26.4.15 | 2026-04-15, prerelease | 588 | [`v26.4.15.schema.json`](schema/v26.4.15.schema.json) | |
| v26.4.17 | 2026-04-17, prerelease | 588 (as v26.4.15) | [`v26.4.17.schema.json`](schema/v26.4.17.schema.json) | |
| v26.4.25 | 2026-04-25, prerelease | 598 | [`v26.4.25.schema.json`](schema/v26.4.25.schema.json) | |
| v26.5.3 | 2026-05-03, prerelease | 604 | [`v26.5.3.schema.json`](schema/v26.5.3.schema.json) | |
| v26.5.9 | 2026-05-09, prerelease | 617 | [`v26.5.9.schema.json`](schema/v26.5.9.schema.json) | |
| v26.6.1 | 2026-06-01, prerelease | 618 | [`v26.6.1.schema.json`](schema/v26.6.1.schema.json) | |
| v26.6.22 | 2026-06-22, prerelease | 614 | [`v26.6.22.schema.json`](schema/v26.6.22.schema.json) | |
| v26.6.27 | 2026-06-27, prerelease | 616 | [`v26.6.27.schema.json`](schema/v26.6.27.schema.json) | |
| v26.7.11 | 2026-07-11, prerelease | 618 | [`v26.7.11.schema.json`](schema/v26.7.11.schema.json) | |
| v26.7.28 | 2026-07-28, prerelease | 619 | [`v26.7.28.schema.json`](schema/v26.7.28.schema.json) | 26.7 |
| v26.9.9 | 2026-09-08, prerelease | 618 | [`v26.9.9.schema.json`](schema/v26.9.9.schema.json) | 26.9 |
| v26.9.30 | 2026-09-30, prerelease | 648 | [`v26.9.30.schema.json`](schema/v26.9.30.schema.json) | 26.9.30 |
| v26.10.10 | 2026-10-10, withdrawn ¹ | 656 | [`v26.10.10.schema.json`](schema/v26.10.10.schema.json) | 26.10 |
| v26.10.21 | 2026-10-21 | 658 | [`v26.10.21.schema.json`](schema/v26.10.21.schema.json) | 26.10.21 |

¹ Withdrawn upstream and its tag deleted; it is read from its release commit `701af607` (`versions.json`, `extra`).

## Adding a new Xray release

Nothing to do by hand when it goes well. [`upstream.yml`](.github/workflows/upstream.yml) runs weekly (and on demand): it clones Xray-core, finds release tags above the floor that the fixture does not have, regenerates `src/core-keys.json` and `schema/`, runs the coverage test and opens a pull request — never a release. The PR body lists, for each new tag, which structs gained, lost or retyped keys against the tag before it.

If the coverage test fails in that PR, the release added something the schemas do not describe. Then, locally:

```sh
git clone https://github.com/XTLS/Xray-core.git ../Xray-core   # once; any full clone with tags
bun run core-keys ../Xray-core                                 # the fixture, every tag in the set
CORE_KEYS_REPORT=1 bun test coverage                           # every gap, with its path
# read the new tag's infra/conf for each finding; change src/schemas/** (or add an
# ALLOWED entry that says why, with the source line)
bun run schema:build                                           # regenerate schema/
bun test
```

If the script stops at a raw field with no `RAW` entry, read what the core decodes it into and add the entry with the line that does it. A release whose tag was later deleted goes in `versions.json` `extra` as `tag@commit`.

## Limits

- **Keys and types, not values.** A schema says which keys a tag reads and what JSON type each one decodes from. Whether `Build()` then accepts the values — a REALITY key of the right length, a VLESS encryption string, two settings that cannot be combined — is not something a schema can know. For that, run the real core: [xray-wasm](https://github.com/bropines/xray-wasm) is Xray-core compiled to WebAssembly, one build per release, and does `xray run -test` in the browser.
- **Value sets are the union.** Enums (`protocol`, `network`, `flow`, mask types…) list what any supported release knows; the per-tag files drop keys, not values.
- **Types are the union too.** A key is typed once for every tag. The one place a release decoded a key differently from all the others — tun's `mtu`, a list on v26.4.13 alone — is on the coverage test's `ALLOWED` list, and the schema types the number every other release reads.
- **Ignored is not refused.** Some keys load on one release and are refused at load on another; the schemas leave the refusal to the core (or xray-wasm).

## Development

```sh
bun install
bun run typecheck                 # tsc --noEmit
bun test                          # coverage, lint, JSONC, JSON Schema (ajv, strict, 2020-12)
bun run core-keys <Xray-core>     # regenerate src/core-keys.json
bun run schema:build              # regenerate schema/ (--check: fail if it would change)
npm pack                          # dist/ via tsc, plus schema/
```

The zod schemas in `src/schemas/` are ported from the [Xray Config UI Editor](https://github.com/bropines/xray-config-ui-editor) (`src/core/xray/schemas`), which keeps its own copy; comments that name `core/xray/…` or "the editor" point there. The generated JSON is committed — it is text, and a raw GitHub or jsDelivr URL to it is what goes in `$schema` — and CI fails when regenerating changes it.

## License

[MIT](LICENSE) © 2026 Sergey Pinus (bropines). Xray-core is © its authors, under the MPL-2.0; this package holds no code from it, only the key names and types read from its tags.
