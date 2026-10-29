# xray-schema

Написанные вручную схемы [zod](https://zod.dev) для конфигов [Xray-core](https://github.com/XTLS/Xray-core), которые тест держит ровно в рамках того, что читает каждый релиз Xray, начиная с v26.3.27. Из них собираются JSON Schema — по одной на каждый релиз и одна на все сразу, — с которыми работает любой редактор: VS Code через `$schema`, Monaco, CodeMirror.

[English version](README.md)

- [Как использовать](#как-использовать): [VS Code](#vs-code) · [Monaco](#monaco) · [CodeMirror](#codemirror) · [zod](#zod) · [`lint()`](#lint) · [`keysFor()`](#keysfor)
- [Почему zod вручную](#почему-zod-вручную-а-не-схема-сгенерированная-из-go)
- [Как coverage держит схемы честными](#как-coverage-держит-схемы-честными)
- [Поддерживаемые релизы](#поддерживаемые-релизы) · [Новый релиз](#как-добавляется-новый-релиз-xray)
- [Ограничения](#ограничения) · [Разработка](#разработка) · [Лицензия](#лицензия)

## Как использовать

> Ссылки `cdn.jsdelivr.net/gh/bropines/xray-schema@…` и пакет в npm заработают после публикации репозитория и пакета.

В [`schema/`](schema/) файлы двух видов:

| Файл | Что в нём |
| --- | --- |
| `schema/xray.schema.json` | все ключи, которые читает хоть один поддерживаемый релиз |
| `schema/<tag>.schema.json` (`v26.7.28.schema.json`, …) | только ключи, которые читает этот релиз |

Берите файл под то ядро, на котором работает конфиг. Объекты всегда открыты (`additionalProperties` разрешены): Xray молча выбрасывает ключ, для которого у него нет поля, так что неизвестный ключ — не ошибка ни для ядра, ни здесь. О таких ключах говорит `lint()`.

### VS Code

Добавьте `$schema` в начало конфига. Xray этот ключ игнорирует — у `Config` такого поля нет.

```jsonc
{
  "$schema": "https://cdn.jsdelivr.net/gh/bropines/xray-schema@v0.1.0/schema/v26.10.21.schema.json",
  "log": { "loglevel": "warning" }
}
```

Или привяжите файлы в `settings.json`, не трогая сами конфиги:

```jsonc
"json.schemas": [
  {
    "fileMatch": ["**/xray/*.json", "**/xray/*.jsonc"],
    "url": "https://cdn.jsdelivr.net/gh/bropines/xray-schema@v0.1.0/schema/xray.schema.json"
  }
]
```

У каждого ключа, который описан в схемах, при наведении видно описание — со ссылкой на строку исходников Xray-core, откуда оно взято.

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

`lint()` возвращает смещения в тексте, поэтому подключается к `@codemirror/lint` напрямую, с комментариями:

```ts
import { linter } from '@codemirror/lint';
import { lint } from 'xray-schema';

const xrayLint = linter(view =>
  lint(view.state.doc.toString(), { tag: 'v26.10.21' })
    .map(({ from = 0, to = from, severity, message }) => ({ from, to, severity, message })));
```

Для автодополнения по JSON Schema подойдёт любое расширение, например [`codemirror-json-schema`](https://www.npmjs.com/package/codemirror-json-schema): `jsonSchema(schema)` с файлом из `xray-schema/schema/`.

### zod

```sh
npm install xray-schema zod   # zod 4 — peer-зависимость
```

```ts
import {
  XrayConfigSchema, InboundSchema, OutboundSchema, RoutingSchema, RoutingRuleSchema,
  BalancerSchema, DnsSchema, ReverseSchema,
  inboundSettingsSchemaFor, outboundSettingsSchemaFor,
  StringListSchema, DurationStringSchema, PortSchema,
} from 'xray-schema';

const config = XrayConfigSchema.parse(JSON.parse(text));

// `settings` у каждого протокола свой, поэтому обёртки оставляют его открытым;
// схему берут по протоколу рядом.
const settings = inboundSettingsSchemaFor(config.inbounds?.[0]?.protocol);
settings?.parse(config.inbounds?.[0]?.settings);
```

Примитивы повторяют формы самого ядра: `StringList` — массив или одна строка, которую ядро режет по `,` (`StringListSchema`, `commaList()`); `duration.Duration` — строка, никогда не число (`DurationStringSchema`); `PortList` и `Int32Range` — число или строка.

### `lint()`

```ts
import { lint } from 'xray-schema';

lint(text);                                   // весь конфиг, любой поддерживаемый релиз
lint(text, { tag: 'v26.3.27' });              // …так, как его читает этот релиз
lint(text, { mode: 'outbounds' });            // один раздел: inbound(s), outbound(s), rule,
                                              // routing, dns, balancer, reverse, none
// → [{ path: ['routing', 'rules', 0, 'outbountTag'], severity: 'warning', from, to,
//      message: 'routing.rules[0].outbountTag: Xray-core v26.3.27 does not read this key; the core ignores it' }]
```

- `error` — тип или форма, которую ядро не декодирует: строка там, где нужен объект, число вместо длительности;
- `warning` — ключ, который ядро молча проигнорирует на указанном релизе (или на всех поддерживаемых). Опечатка в ключе — самый частый способ получить конфиг, который «ничего не делает», и ядро об этом не скажет.

В тексте можно писать комментарии `//`, `#` и `/* */` — их вырезает загрузчик самого Xray. Висячую запятую парсер проходит, чтобы проверить остальной файл, и сообщает о ней как об ошибке, потому что Xray её не примет; `allowTrailingCommas: true` — для текста, который перед Xray чистит какой-то инструмент. `from`/`to` — смещения в тексте: значение для ошибки, ключ для непрочитанного ключа. `lintValue(value, opts)` принимает уже разобранное значение, `parseJsonc(text)` — сам парсер.

Сообщения `lint()` — на английском, как и в редакторе, откуда он перенесён.

### `keysFor()`

```ts
import { keysFor, supportedTags } from 'xray-schema';

supportedTags;                                 // ['v26.3.27', …, 'v26.10.21']
keysFor('v26.9.30').structs.MasqueConfig;      // { host: 'string', path: 'string', … }
keysFor('v26.9.30').protocols.inbound.masque;  // 'MasqueServerConfig'
```

Сама таблица по тегам — `xray-schema/core-keys.json`.

## Почему zod вручную, а не схема, сгенерированная из Go

Очевидный путь — пройтись по Go-структурам Xray. Он ошибается именно там, где это важно, потому что заметная часть конфига вообще не декодируется по тегам структур. Нагляднее всего правило маршрутизации: Xray разбирает его вручную (`parseFieldRule`), и структура, которую видит генератор, `RouterRule`, содержит три поля — `ruleTag`, `outboundTag`, `balancerTag`. Сгенерированная схема знает только их и с `additionalProperties: false` объявляет каждое настоящее правило невалидным из-за `domain`, `ip`, `port` и остального — на конфигах, которые прекрасно работают.

То же везде, где ядро декодирует само: `settings` превращается в свою структуру для каждого протокола; `StringList` принимает массив или строку через запятую; `dest` у fallback — номер порта или адрес; `tcpFastOpen` — bool или число; длительность — строка, а число роняет весь документ. Эти схемы написаны так, чтобы говорить, что ядро принимает на самом деле, а держит их в этих рамках тест, а не доверие.

## Как coverage держит схемы честными

`scripts/core-keys.ts` читает `infra/conf` каждого тега релиза (через `git cat-file`, ничего не переключая) и пишет [`src/core-keys.json`](src/core-keys.json): каждую структуру, до которой доходит корневой `Config`, каждый её ключ с Go-типом **на каждом теге**, и в какую структуру превращается `settings` каждого протокола на каждом теге. Там, где ядро само декодирует `json.RawMessage` или `interface{}`, результат — код, а не тег структуры, поэтому он записан вручную в таблицу `RAW` скрипта, со строкой исходников, которая это делает. Сырое поле, которого нет в `RAW`, останавливает скрипт.

[`test/coverage.test.ts`](test/coverage.test.ts) проходит схемы zod рядом с этими структурами и падает, если:

- ключ, который декодирует какой-то тег, не имеет пары в zod;
- тип в zod ядро не декодирует (или zod пропускает форму, которую ядро отвергает);
- ключ из zod не читает ни один тег;

— если только запись в `ALLOWED` не объясняет, почему разрыв оставлен намеренно: ключ, который каждый релиз отвергает при загрузке, поле, которое загрузчик выставляет сам, ключ только для клиента в общей структуре. Запись `ALLOWED`, которая больше не совпадает ни с одним разрывом, тоже роняет тест — список может только сокращаться.

То же сопоставление объектов zod со структурами собирает JSON Schema по тегам: ключ уходит из `properties` на теге, где его не декодирует ни одна структура за этим объектом. Объект, который обход не смог сопоставить со структурой (settings слоя finalmask, которые декодируются по типу маски), остаётся целиком: о нём ничего не известно, значит, ничего и не выбрасывается.

## Поддерживаемые релизы

Каждый релиз Xray-core начиная с **v26.3.27**, и стабильные, и пререлизы — набор, который описывает [`versions.json`](versions.json), по тому же правилу, что и [xray-wasm](https://github.com/bropines/xray-wasm). *Ключей* — сколько ключей структур декодирует тег; почти каждый релиз отличается от предыдущего, поэтому файлы и сделаны по тегам. *Линия* — название группы тегов в Xray Config UI Editor, просто метка.

| Тег | Вышел | Ключей | Схема | Линия |
| --- | --- | ---: | --- | --- |
| v26.3.27 | 2026-03-27 | 582 | [`v26.3.27.schema.json`](schema/v26.3.27.schema.json) | 26.3 |
| v26.4.13 | 2026-04-13, пререлиз | 587 | [`v26.4.13.schema.json`](schema/v26.4.13.schema.json) | |
| v26.4.15 | 2026-04-15, пререлиз | 588 | [`v26.4.15.schema.json`](schema/v26.4.15.schema.json) | |
| v26.4.17 | 2026-04-17, пререлиз | 588 (как v26.4.15) | [`v26.4.17.schema.json`](schema/v26.4.17.schema.json) | |
| v26.4.25 | 2026-04-25, пререлиз | 598 | [`v26.4.25.schema.json`](schema/v26.4.25.schema.json) | |
| v26.5.3 | 2026-05-03, пререлиз | 604 | [`v26.5.3.schema.json`](schema/v26.5.3.schema.json) | |
| v26.5.9 | 2026-05-09, пререлиз | 617 | [`v26.5.9.schema.json`](schema/v26.5.9.schema.json) | |
| v26.6.1 | 2026-06-01, пререлиз | 618 | [`v26.6.1.schema.json`](schema/v26.6.1.schema.json) | |
| v26.6.22 | 2026-06-22, пререлиз | 614 | [`v26.6.22.schema.json`](schema/v26.6.22.schema.json) | |
| v26.6.27 | 2026-06-27, пререлиз | 616 | [`v26.6.27.schema.json`](schema/v26.6.27.schema.json) | |
| v26.7.11 | 2026-07-11, пререлиз | 618 | [`v26.7.11.schema.json`](schema/v26.7.11.schema.json) | |
| v26.7.28 | 2026-07-28, пререлиз | 619 | [`v26.7.28.schema.json`](schema/v26.7.28.schema.json) | 26.7 |
| v26.9.9 | 2026-09-08, пререлиз | 618 | [`v26.9.9.schema.json`](schema/v26.9.9.schema.json) | 26.9 |
| v26.9.30 | 2026-09-30, пререлиз | 648 | [`v26.9.30.schema.json`](schema/v26.9.30.schema.json) | 26.9.30 |
| v26.10.10 | 2026-10-10, отозван ¹ | 656 | [`v26.10.10.schema.json`](schema/v26.10.10.schema.json) | 26.10 |
| v26.10.21 | 2026-10-21 | 658 | [`v26.10.21.schema.json`](schema/v26.10.21.schema.json) | 26.10.21 |

¹ Отозван апстримом, тег удалён; читается из релизного коммита `701af607` (`versions.json`, `extra`).

## Как добавляется новый релиз Xray

Если всё хорошо — руками ничего делать не нужно. [`upstream.yml`](.github/workflows/upstream.yml) запускается раз в неделю (и вручную): клонирует Xray-core, находит теги релизов выше нижней границы, которых нет в фикстуре, пересобирает `src/core-keys.json` и `schema/`, гоняет тест coverage и открывает pull request — не релиз. В описании PR для каждого нового тега перечислено, какие структуры получили, потеряли или сменили тип ключей относительно предыдущего тега.

Если в этом PR тест coverage падает, релиз добавил то, чего схемы не описывают. Тогда локально:

```sh
git clone https://github.com/XTLS/Xray-core.git ../Xray-core   # один раз; подойдёт любой полный клон с тегами
bun run core-keys ../Xray-core                                 # фикстура, все теги набора
CORE_KEYS_REPORT=1 bun test coverage                           # все разрывы с путями
# прочитать infra/conf нового тега для каждой находки; поправить src/schemas/** (или
# добавить запись ALLOWED с объяснением и строкой исходников)
bun run schema:build                                           # пересобрать schema/
bun test
```

Если скрипт остановился на сыром поле без записи в `RAW`, прочитайте, во что его декодирует ядро, и добавьте запись со строкой, которая это делает. Релиз, чей тег потом удалили, добавляется в `extra` в `versions.json` как `tag@commit`.

## Ограничения

- **Ключи и типы, а не значения.** Схема говорит, какие ключи читает тег и из какого JSON-типа декодируется каждый. Примет ли потом `Build()` сами значения — ключ REALITY нужной длины, строку VLESS Encryption, две несовместимые настройки — схема знать не может. Для этого нужно настоящее ядро: [xray-wasm](https://github.com/bropines/xray-wasm) — Xray-core, собранный в WebAssembly, по сборке на релиз, делает `xray run -test` прямо в браузере.
- **Наборы значений — объединение.** Перечисления (`protocol`, `network`, `flow`, типы масок…) содержат то, что знает хоть один поддерживаемый релиз; файлы по тегам убирают ключи, а не значения.
- **Типы — тоже объединение.** У ключа один тип на все теги. Единственное место, где релиз декодировал ключ не так, как все остальные, — `mtu` у tun, список только в v26.4.13, — внесено в `ALLOWED` теста coverage, и схема описывает число, которое читают все остальные релизы.
- **Игнорируется — не значит отвергается.** Некоторые ключи загружаются на одном релизе и отвергаются при загрузке на другом; отказ схемы оставляют ядру (или xray-wasm).

## Разработка

```sh
bun install
bun run typecheck                 # tsc --noEmit
bun test                          # coverage, lint, JSONC, JSON Schema (ajv, strict, 2020-12)
bun run core-keys <Xray-core>     # пересобрать src/core-keys.json
bun run schema:build              # пересобрать schema/ (--check: упасть, если что-то изменится)
npm pack                          # dist/ через tsc, плюс schema/
```

Схемы zod в `src/schemas/` перенесены из [Xray Config UI Editor](https://github.com/bropines/xray-config-ui-editor) (`src/core/xray/schemas`), где живёт своя копия; комментарии, в которых упоминается `core/xray/…` или «редактор», указывают туда. Сгенерированный JSON закоммичен — это текст, и именно прямую ссылку на него через GitHub или jsDelivr ставят в `$schema`, — а CI падает, если пересборка его меняет.

## Лицензия

[MIT](LICENSE) © 2026 Sergey Pinus (bropines). Xray-core © его авторы, под MPL-2.0; в этом пакете нет его кода — только имена ключей и типы, прочитанные из его тегов.
