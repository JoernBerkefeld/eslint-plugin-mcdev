# eslint-plugin-mcdev

Run your SFMC [mcdev](https://github.com/Accenture/sfmc-devtools) metadata validation rules — your project's `.mcdev-validations.js` **plus mcdev's built-in defaults** — as ESLint diagnostics. This lets the exact same rules that run during `mcdev deploy` / `mcdev retrieve` also run in **CI/CD** and, through the standard **ESLint VS Code extension**, live in the editor.

The plugin does **not** re-implement your rules. It reconstructs mcdev's `(definition, item, targetDir, codeExtractItemArr, Util)` contract from each metadata file on disk and calls your rules unchanged.

## How it works

mcdev validation rules are pure functions over **parsed metadata objects**, not over source text/AST. ESLint is text/AST-based. The bridge is an ESLint **processor** that:

1. Claims `retrieve/**/*-meta.json` and `deploy/**/*-meta.json` files.
2. Derives `type`, `bu`, `cred`, `targetDir`, and `key` from the file path.
3. Loads sibling code files (`.html` / `.amp` / `.ssjs`) into the `codeExtractItemArr` shape for `asset` rules.
4. Merges your `.mcdev-validations.js` rules over mcdev's defaults (`Object.assign({}, defaultRules, customRules)`), reads per-rule severity from `.mcdevrc.json`, and runs each enabled rule's `passed()`.
5. Emits one ESLint message per failing rule at line 1 of the metadata file, using the rule's `failedMsg`.

Each metadata JSON file is one lint target; each failing validation rule is one ESLint message.

### On-disk layout it expects

```
retrieve/<cred>/<bu>/<type>/<key>.<type>[-<subtype>]-meta.json
retrieve/<cred>/<bu>/asset/block/<key>.asset-block-meta.json  (+ sibling .html/.amp/.ssjs)
```

- `type` = folder segment right after the BU.
- `bu` = segment before the type folder.
- `targetDir` = path up to and including the BU folder (rules read the last segment via `buSuffixMap`).

## Requirements

- Node.js `>=22` (the processor loads `.mcdev-validations.js` synchronously via Node's synchronous `require()` of ESM).
- ESLint `>=9` (flat config).
- `mcdev` `>=9` installed in the project (used as a peer dependency for its type definitions, default rules, and `Util`).

## Install

```bash
npm install --save-dev eslint-plugin-mcdev eslint mcdev
```

## Usage — flat config

Add the recommended preset to your `eslint.config.js` (or `eslint.config.mjs`):

```js
import mcdev from 'eslint-plugin-mcdev';

export default [
    // ... your other configs
    ...mcdev.configs.recommended,
];
```

The preset wires the processor to `**/retrieve/**/*-meta.json` and `**/deploy/**/*-meta.json`.

### Manual wiring

If you need custom file globs, reference the processor directly:

```js
import mcdev from 'eslint-plugin-mcdev';

export default [
    {
        files: ['**/retrieve/**/*-meta.json'],
        plugins: { mcdev },
        processor: 'mcdev/mcdev',
    },
];
```

## Validation method (strictness)

mcdev applies different severities per **method** (`retrieve`, `buildDefinition`, `deploy`) in `.mcdevrc.json` → `options.validation.<method>` with `type`-based overrides.

This plugin reads a dedicated **`eslint`** method. If `options.validation.eslint` is **not** defined, it falls back to **`deploy`** (the strictest built-in method, matching what blocks a deploy). This lets you start with zero extra config and later tune ESLint strictness independently from your deploy gate:

```jsonc
{
  "options": {
    "validation": {
      "deploy": {
        "noGuidKeys": "error",
        "keySuffix": "error"
      },
      // optional: overrides just for ESLint; omit this block to reuse "deploy"
      "eslint": {
        "noGuidKeys": "warn",
        "keySuffix": "error"
      }
    }
  }
}
```

Severities map to ESLint as: `error` and `fix` → error, everything else (`warn`) → warning, `off` / unset → skipped.

## CI / CD

Lint only committed metadata. `deploy/` is typically git-ignored, so it will not exist in CI — point ESLint at `retrieve/`:

```bash
# fail the pipeline on any error-severity mcdev validation
npx eslint "retrieve/**/*-meta.json"
```

`error`-severity rules exit non-zero; `warn`-severity rules report but do not fail unless you run ESLint with `--max-warnings 0`. Tune per-stage strictness through `options.validation.eslint` (or `deploy`) in `.mcdevrc.json` — see [Validation method](#validation-method-strictness).

## VS Code

No custom extension is needed — this works through the standard **[ESLint extension](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)**. Because the plugin validates JSON files, tell the extension to lint JSON in your workspace `.vscode/settings.json`:

```json
{
    "eslint.validate": ["javascript", "json"],
    "eslint.useFlatConfig": true
}
```

With this in place, opening a `*-meta.json` file under `retrieve/` or `deploy/` surfaces mcdev validation failures inline as Problems.

> If you also use the [SFMC Language extension](https://marketplace.visualstudio.com/items?itemName=joernberkefeld.sfmc-language), it already contributes an `eslint.validate` default that includes `json` — so no manual setting is needed. But note that a hand-written `eslint.validate` array in your own `settings.json` **replaces** the contributed default (VS Code does not merge them), so if you set it yourself you must include `"json"` for this plugin to run.

## Using alongside eslint-plugin-sfmc

[`eslint-plugin-sfmc`](https://www.npmjs.com/package/eslint-plugin-sfmc) and this plugin coexist without a processor conflict — they claim different files (`*.amp` / `*.ssjs` / `*.html` vs `*-meta.json`) and use different processor IDs.

One thing to watch: mcdev retrieves asset code as sibling **`.html` / `.amp` / `.ssjs`** files inside `retrieve/`. `eslint-plugin-sfmc`'s default globs (`**/*.html`, `**/*.amp`, `**/*.ssjs`) match those retrieved files too, so it will lint mcdev's generated output — usually duplicated across BUs and not fixable in `retrieve/`. Scope `eslint-plugin-sfmc` to your authored source so it does not lint the retrieved copies:

```js
import sfmc from 'eslint-plugin-sfmc';
import mcdev from 'eslint-plugin-mcdev';

export default [
    // eslint-plugin-sfmc: your authored source only (adjust to your layout)
    {
        files: ['src/**/*.{amp,ssjs,html}'],
        // spread the sfmc rules/processor you use, e.g. ...sfmc.configs.recommended (re-scoped)
    },
    // eslint-plugin-mcdev: owns the retrieved/deployed metadata
    ...mcdev.configs.recommended,
];
```

If you prefer using `sfmc.configs.recommended` as-is (which targets `**/*.amp` etc.), add per-config `ignores: ['retrieve/**', 'deploy/**']` to the sfmc blocks. Avoid a top-level `{ ignores: ['retrieve/**'] }` object with no `files` key — that is a **global** ignore and would also disable `eslint-plugin-mcdev` on `retrieve/`.

## What gets reported

| Rule outcome | ESLint result |
| --- | --- |
| `passed()` returns `true` | nothing |
| `passed()` returns `false` | message with severity from `.mcdevrc.json` (`error` or `fix` → error, otherwise warning) |
| `passed()` returns `null` (filter) | warning: "Item would be filtered out during deploy: …" |
| rule throws | warning (rule name + error message), never crashes the lint run |
| severity is `off` / rule not configured | skipped |
| invalid JSON | single `mcdev/parse-error` |
| unknown metadata `type` | nothing |

Message rule IDs are `mcdev/<ruleName>` (e.g. `mcdev/keySuffix`, `mcdev/noGuidKeys`).

## Notes

- Your `.mcdev-validations.js` does **not** need any changes — it is consumed as-is with mcdev's real `Util` passed in.
- Autofix (`fix()`) is not wired into ESLint `--fix` yet; this release is read-only validation. Because of that, a rule configured as `"fix"` in `.mcdevrc.json` is reported as an **error** (not silently auto-fixed).

## License

MIT © Joern Berkefeld
