import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runValidation, clearCustomFunctionCache } from '../lib/engine.js';
import { parseMetaPath, collectCodeExtractItems } from '../lib/paths.js';
import { findMcdevrc, getValidationConfig, clearRcCache } from '../lib/mcdevrc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.join(__dirname, 'fixtures', 'project');

/**
 * Resolves a fixture metadata file path.
 *
 * @param {...string} parts path segments below the fixture project root
 * @returns {string} absolute file path
 */
function fixture(...parts) {
    return path.join(PROJECT, ...parts);
}

/**
 * Runs the mcdev validation engine against a fixture file.
 *
 * @param {string} file absolute path to a *-meta.json fixture
 * @param {'retrieve'|'buildDefinition'|'deploy'} method validation method
 * @returns {object[]} ESLint messages
 */
function lint(file, method) {
    clearRcCache();
    clearCustomFunctionCache();
    return runValidation(file, fs.readFileSync(file, 'utf8'), { method });
}

test('parseMetaPath infers type, subType, bu, cred, key, targetDir', () => {
    const file = fixture(
        'retrieve',
        'R1',
        'DEV',
        'asset',
        'block',
        'Foo_DEV.asset-block-meta.json',
    );
    const info = parseMetaPath(file);
    assert.equal(info.type, 'asset');
    assert.equal(info.subType, 'block');
    assert.equal(info.bu, 'DEV');
    assert.equal(info.cred, 'R1');
    assert.equal(info.key, 'Foo_DEV');
    assert.ok(info.targetDir.endsWith(path.join('retrieve', 'R1', 'DEV')));
});

test('parseMetaPath handles single-token type (journey)', () => {
    const file = fixture(
        'retrieve',
        'R1',
        'DEV',
        'journey',
        'RS_NotificationEmail.journey-meta.json',
    );
    const info = parseMetaPath(file);
    assert.equal(info.type, 'journey');
    assert.equal(info.subType, null);
    assert.equal(info.key, 'RS_NotificationEmail');
});

test('parseMetaPath returns null for non-meta files', () => {
    assert.equal(parseMetaPath('/tmp/foo.json'), null);
    assert.equal(parseMetaPath('/tmp/foo.html'), null);
});

test('collectCodeExtractItems reads sibling code file', () => {
    const file = fixture(
        'retrieve',
        'R1',
        'DEV',
        'asset',
        'block',
        'Foo_DEV.asset-block-meta.json',
    );
    const info = parseMetaPath(file);
    const codeArray = collectCodeExtractItems(file, info);
    assert.equal(codeArray.length, 1);
    assert.equal(codeArray[0].fileExt, 'html');
    assert.equal(codeArray[0].fileName, 'Foo_DEV');
    assert.deepEqual(codeArray[0].subFolder, ['asset', 'block']);
    assert.ok(codeArray[0].content.includes('ContentBlockById'));
});

test('getValidationConfig applies type overrides (journey noGuidKeys off)', () => {
    const rc = findMcdevrc(PROJECT);
    const journeyDeploy = getValidationConfig(rc.config, 'deploy', 'journey');
    assert.equal(journeyDeploy.noGuidKeys, 'off');
    assert.equal(journeyDeploy.keySuffix, 'error');
    const deDeploy = getValidationConfig(rc.config, 'deploy', 'dataExtension');
    assert.equal(deDeploy.noGuidKeys, 'error');
    // overrides key must be stripped from the resolved config
    assert.equal(journeyDeploy.overrides, undefined);
});

test('failing journey reports keySuffix as error (deploy)', () => {
    const messages = lint(
        fixture('retrieve', 'R1', 'DEV', 'journey', 'RS_NotificationEmail.journey-meta.json'),
        'deploy',
    );
    const keySuffix = messages.find((m) => m.ruleId === 'mcdev/keySuffix');
    assert.ok(keySuffix, 'keySuffix message expected');
    assert.equal(keySuffix.severity, 2);
    assert.match(keySuffix.message, /_DEV/);
    // noGuidKeys is overridden to "off" for journey -> no message
    assert.equal(
        messages.find((m) => m.ruleId === 'mcdev/noGuidKeys'),
        undefined,
    );
});

test('passing journey (Welcome_DEV) reports nothing', () => {
    const messages = lint(
        fixture('retrieve', 'R1', 'DEV', 'journey', 'Welcome_DEV.journey-meta.json'),
        'deploy',
    );
    assert.deepEqual(messages, []);
});

test('asset with ampscript script tag + ContentBlockById fails both rules (deploy)', () => {
    const messages = lint(
        fixture('retrieve', 'R1', 'DEV', 'asset', 'block', 'Foo_DEV.asset-block-meta.json'),
        'deploy',
    );
    const ids = messages.map((m) => m.ruleId).toSorted((a, b) => a.localeCompare(b));
    assert.deepEqual(ids, ['mcdev/noAmpscriptHtmlTag', 'mcdev/onlyCBbyKey']);
    assert.ok(messages.every((m) => m.severity === 2));
});

test('clean asset (Good_DEV) reports nothing', () => {
    const messages = lint(
        fixture('retrieve', 'R1', 'DEV', 'asset', 'block', 'Good_DEV.asset-block-meta.json'),
        'deploy',
    );
    assert.deepEqual(messages, []);
});

test('off rules are skipped under retrieve method (onlyCBbyKey)', () => {
    const messages = lint(
        fixture('retrieve', 'R1', 'DEV', 'asset', 'block', 'Foo_DEV.asset-block-meta.json'),
        'retrieve',
    );
    // onlyCBbyKey is "off" for retrieve -> only the AMPscript-tag warning remains
    assert.deepEqual(
        messages.map((m) => m.ruleId),
        ['mcdev/noAmpscriptHtmlTag'],
    );
    assert.equal(messages[0].severity, 1);
});

test('severity mapping: retrieve => warn (1), deploy => error (2)', () => {
    const file = fixture(
        'retrieve',
        'R1',
        'DEV',
        'dataExtension',
        '0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d.dataExtension-meta.json',
    );
    const retrieveMsgs = lint(file, 'retrieve');
    assert.ok(retrieveMsgs.length > 0);
    assert.ok(retrieveMsgs.every((m) => m.severity === 1));

    const deployMsgs = lint(file, 'deploy');
    assert.ok(deployMsgs.length > 0);
    assert.ok(deployMsgs.every((m) => m.severity === 2));
});

test('GUID key + root folder are flagged (deploy)', () => {
    const messages = lint(
        fixture(
            'retrieve',
            'R1',
            'DEV',
            'dataExtension',
            '0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d.dataExtension-meta.json',
        ),
        'deploy',
    );
    const ids = messages.map((m) => m.ruleId);
    assert.ok(ids.includes('mcdev/noGuidKeys'));
    assert.ok(ids.includes('mcdev/noRootFolder'));
});

test('rule exceptions are caught and surfaced as a warning (not a crash)', () => {
    const messages = lint(
        fixture('retrieve', 'R1', 'DEV', 'dataExtension', 'Throwing_DEV.dataExtension-meta.json'),
        'deploy',
    );
    const thrown = messages.find((m) => m.ruleId === 'mcdev/throwsOnPurpose');
    assert.ok(thrown, 'expected the throwing rule to be reported');
    assert.equal(thrown.severity, 1);
    assert.match(thrown.message, /threw an error/);
});

test('invalid JSON produces a single parse-error message', () => {
    const file = fixture(
        'retrieve',
        'R1',
        'DEV',
        'journey',
        'RS_NotificationEmail.journey-meta.json',
    );
    clearRcCache();
    clearCustomFunctionCache();
    const messages = runValidation(file, '{ not valid json', { method: 'deploy' });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].ruleId, 'mcdev/parse-error');
    assert.equal(messages[0].severity, 2);
});

test('unknown metadata type returns no messages', () => {
    const messages = runValidation('/some/where/Foo.unknownType-meta.json', '{}', {
        method: 'deploy',
    });
    assert.deepEqual(messages, []);
});
