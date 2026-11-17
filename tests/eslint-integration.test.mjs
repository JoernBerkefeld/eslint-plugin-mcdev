import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint, Linter } from 'eslint';

test('repository autofix preserves starred multiline JSDoc', async () => {
    const eslint = new ESLint({
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        fix: true,
    });
    const filePath = 'lib/jsdoc-regression.js';
    const rule = 'unicorn/no-asterisk-prefix-in-documentation-comments';
    const config = await eslint.calculateConfigForFile(filePath);
    assert.equal(config.rules[rule][0], 0);
    const comment =
        '/**\n * A representative documentation comment.\n * A second starred line.\n */';
    const code = `${comment}\nexport const answer = 42;\n`;
    const [result] = await eslint.lintText(code, { filePath });
    assert.equal(result.fatalErrorCount, 0);
    assert.ok((result.output ?? code).includes(comment));
    assert.ok(result.messages.every((message) => message.ruleId !== rule));
});
import { runValidation, clearCustomFunctionCache } from '../lib/engine.js';
import { clearRcCache } from '../lib/mcdevrc.js';
import plugin from '../lib/index.js';
import { mcdevProcessor } from '../lib/processor.js';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.join(__dirname, 'fixtures', 'project');

test('plugin exposes processor and recommended flat config', () => {
    assert.equal(typeof plugin.processors.mcdev.preprocess, 'function');
    assert.equal(typeof plugin.processors.mcdev.postprocess, 'function');
    assert.ok(Array.isArray(plugin.configs.recommended));
    assert.equal(plugin.configs.recommended[0].processor, 'mcdev/mcdev');
    assert.ok(plugin.configs.recommended[0].files.includes('**/retrieve/**/*-meta.json'));
});

test('processor preprocess returns an empty virtual block', () => {
    const blocks = mcdevProcessor.preprocess('{"a":1}', 'foo.journey-meta.json');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].text, '');
});

test('Linter.verify runs the processor and yields mcdev messages', () => {
    clearRcCache();
    clearCustomFunctionCache();
    const file = path.join(
        PROJECT,
        'retrieve',
        'R1',
        'DEV',
        'journey',
        'RS_NotificationEmail.journey-meta.json',
    );
    const linter = new Linter();
    const messages = linter.verify(
        fs.readFileSync(file, 'utf8'),
        [
            {
                files: ['**/*-meta.json'],
                plugins: { mcdev: plugin },
                processor: 'mcdev/mcdev',
            },
        ],
        { filename: file },
    );
    const keySuffix = messages.find((m) => m.ruleId === 'mcdev/keySuffix');
    assert.ok(keySuffix, 'keySuffix should be reported through the processor');
    assert.equal(keySuffix.severity, 2);
});

test('runValidation and the processor produce the same messages', () => {
    clearRcCache();
    clearCustomFunctionCache();
    const file = path.join(
        PROJECT,
        'retrieve',
        'R1',
        'DEV',
        'asset',
        'block',
        'Foo_DEV.asset-block-meta.json',
    );
    const text = fs.readFileSync(file, 'utf8');
    const direct = runValidation(file, text, { method: 'deploy' });
    mcdevProcessor.preprocess(text, file);
    const viaProcessor = mcdevProcessor.postprocess([[]], file);
    assert.deepEqual(
        viaProcessor.map((m) => m.ruleId).toSorted((a, b) => a.localeCompare(b)),
        direct.map((m) => m.ruleId).toSorted((a, b) => a.localeCompare(b)),
    );
});
