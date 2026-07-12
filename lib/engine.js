'use strict';
import process from 'node:process';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import MetadataTypeDefinitions from 'mcdev/MetadataTypeDefinitions';
import { Util } from 'mcdev/util/util';
import { parseMetaPath, collectCodeExtractItems } from './paths.js';
import { findMcdevrc, getValidationConfig } from './mcdevrc.js';
import { getDefaultRules } from './default-rules.js';

const require = createRequire(import.meta.url);

/**
 * @typedef {object} LintMessage
 * @property {string} ruleId identifier ("mcdev/<ruleName>")
 * @property {1|2} severity ESLint severity (1 = warning, 2 = error)
 * @property {string} message failedMsg from the validation rule
 * @property {number} line always 1 (metadata files are validated as a whole)
 * @property {number} column always 1
 */

/**
 * @typedef {(definition: object, item: object, targetDirectory: string, codeExtractItemArray: object[]|null, utility: object) => object} CustomValidationFn
 */

/** @type {Map.<string, CustomValidationFn|null>} cache of project-root -> custom validation() function */
const customFunctionCache = new Map();

/**
 * Synchronously loads the project's .mcdev-validations.js custom `validation()` function.
 * ESLint processors are synchronous, so we rely on Node's synchronous `require()` of ESM
 * (Node >= 22.12). The custom file has no top-level await (it only exports a function),
 * so this is safe. Results are cached per project root.
 *
 * @param {string} projectRoot directory that contains .mcdev-validations.js
 * @returns {CustomValidationFn|null} the custom validation function or null when absent/invalid
 */
function loadCustomFunction(projectRoot) {
    const root = path.resolve(projectRoot);
    if (customFunctionCache.has(root)) {
        return customFunctionCache.get(root);
    }
    const customFile = path.join(root, '.mcdev-validations.js');
    let validationFunction = null;
    if (fs.existsSync(customFile)) {
        try {
            const imported = require(customFile);
            validationFunction =
                typeof imported.validation === 'function' ? imported.validation : null;
        } catch (ex) {
            Util.logger?.debug?.('Could not load .mcdev-validations.js: ' + ex.message);
            validationFunction = null;
        }
    }
    customFunctionCache.set(root, validationFunction);
    return validationFunction;
}

/**
 * Clears the cached custom validation functions (useful for tests).
 *
 * @returns {void}
 */
export function clearCustomFunctionCache() {
    customFunctionCache.clear();
}

/**
 * Builds the merged validation rule list (defaults + custom) for a single item,
 * mirroring mcdev's validationsRules() but synchronously.
 *
 * @param {string} projectRoot project root used to look up the cached custom rules
 * @param {object} definition mcdev type definition
 * @param {object} item parsed metadata item
 * @param {string} targetDirectory retrieve/<cred>/<bu>
 * @param {object[]|null} codeExtractItemArray extracted code snippets (asset only)
 * @returns {object} merged rule list ({ ruleName: { failedMsg, passed() } })
 */
function buildRules(projectRoot, definition, item, targetDirectory, codeExtractItemArray) {
    const defaultRules = getDefaultRules(definition, item, codeExtractItemArray, Util);
    const customFunction = loadCustomFunction(projectRoot);
    let customRules = {};
    if (customFunction) {
        try {
            customRules =
                customFunction(definition, item, targetDirectory, codeExtractItemArray, Util) || {};
        } catch (ex) {
            Util.logger?.debug?.('custom validation() threw: ' + ex.message);
            customRules = {};
        }
    }
    return Object.assign({}, defaultRules, customRules);
}

/**
 * Runs mcdev's validation rules against a single metadata JSON file and maps the
 * result to ESLint messages. Reuses the project's .mcdev-validations.js plus mcdev's
 * built-in default rules, so behavior matches mcdev.
 *
 * @param {string} filename absolute or relative path to a *-meta.json file
 * @param {string} text raw JSON text of the metadata file
 * @param {object} [runtimeOptions] optional overrides
 * @param {'retrieve'|'buildDefinition'|'deploy'} [runtimeOptions.method] validation method (default: "deploy")
 * @returns {LintMessage[]} ESLint messages (empty when all rules pass or no config applies)
 */
export function runValidation(filename, text, runtimeOptions = {}) {
    const info = parseMetaPath(filename);
    if (!info) {
        return [];
    }
    const definition = MetadataTypeDefinitions[info.type];
    if (!definition) {
        return [];
    }

    let item;
    try {
        item = JSON.parse(text);
    } catch (ex) {
        return [
            {
                ruleId: 'mcdev/parse-error',
                severity: 2,
                message: 'Could not parse metadata JSON: ' + ex.message,
                line: 1,
                column: 1,
            },
        ];
    }

    const rc = findMcdevrc(filename);
    const projectRoot = rc ? rc.dir : process.cwd();
    const method = runtimeOptions.method || readMethodFromEnvironment() || 'deploy';
    const validationConfig = rc ? getValidationConfig(rc.config, method, info.type) : null;
    if (!validationConfig) {
        return [];
    }

    const codeArray = info.type === 'asset' ? collectCodeExtractItems(filename, info) : null;

    let validationRules;
    try {
        validationRules = buildRules(projectRoot, definition, item, info.targetDir, codeArray);
    } catch (ex) {
        return [
            {
                ruleId: 'mcdev/engine-error',
                severity: 2,
                message: 'mcdev validation engine failed: ' + (ex?.message || String(ex)),
                line: 1,
                column: 1,
            },
        ];
    }

    /** @type {LintMessage[]} */
    const messages = [];
    const skipValidation = definition.skipValidation || {};
    for (const [ruleName, rule] of Object.entries(validationRules)) {
        const severityString = validationConfig[ruleName];
        const isSkipped = Object.hasOwn(skipValidation, ruleName) && skipValidation[ruleName];
        if (!severityString || severityString === 'off' || isSkipped) {
            continue;
        }
        let passed;
        try {
            passed = rule.passed();
        } catch (ex) {
            messages.push({
                ruleId: `mcdev/${ruleName}`,
                severity: 1,
                message: `Validation rule "${ruleName}" threw an error: ${ex?.message || String(ex)}`,
                line: 1,
                column: 1,
            });
            continue;
        }
        if (passed === false) {
            messages.push({
                ruleId: `mcdev/${ruleName}`,
                severity: severityString === 'error' ? 2 : 1,
                message: rule.failedMsg,
                line: 1,
                column: 1,
            });
        } else if (passed === null) {
            messages.push({
                ruleId: `mcdev/${ruleName}`,
                severity: 1,
                message: 'Item would be filtered out during deploy: ' + rule.failedMsg,
                line: 1,
                column: 1,
            });
        }
    }
    return messages;
}

/**
 * Reads the desired validation method from the MCDEV_VALIDATION_METHOD env var.
 *
 * @returns {'retrieve'|'buildDefinition'|'deploy'|null} the configured method or null
 */
function readMethodFromEnvironment() {
    const value = process.env.MCDEV_VALIDATION_METHOD;
    const allowed = new Set(['retrieve', 'buildDefinition', 'deploy']);
    return allowed.has(value) ? value : null;
}
