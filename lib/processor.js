'use strict';
import { runValidation } from './engine.js';

/**
 * Stash of raw metadata JSON text keyed by filename, populated in preprocess and
 * consumed in postprocess (ESLint calls both synchronously for the same file).
 *
 * @type {Map.<string, string>}
 */
const textByFilename = new Map();

/**
 * ESLint processor that treats a mcdev "*-meta.json" file as a single lint target.
 *
 * mcdev validation rules operate on the parsed metadata object (not source text/AST),
 * so we do not hand any JS/JSON to ESLint's own parser. preprocess returns an empty
 * virtual block (no ESLint rules run on it); postprocess runs mcdev's validation engine
 * and emits the resulting messages positioned at line 1 of the file.
 */
export const mcdevProcessor = {
    meta: {
        name: 'eslint-plugin-mcdev/processor',
        version: '0.1.0',
    },
    supportsAutofix: false,

    /**
     * @param {string} text raw file content
     * @param {string} filename absolute file path being linted
     * @returns {{text: string, filename: string}[]} a single empty virtual block
     */
    preprocess(text, filename) {
        textByFilename.set(filename, text);
        // empty block with a .txt name so no language plugin tries to parse it
        return [{ text: '', filename: 'mcdev-validation.txt' }];
    },

    /**
     * @param {object[][]} _messages messages ESLint produced per block (ignored)
     * @param {string} filename absolute file path being linted
     * @returns {object[]} mcdev validation messages mapped to ESLint message shape
     */
    postprocess(_messages, filename) {
        const text = textByFilename.get(filename) ?? '';
        textByFilename.delete(filename);
        let results;
        try {
            results = runValidation(filename, text);
        } catch (ex) {
            return [
                {
                    ruleId: 'mcdev/engine-error',
                    severity: 2,
                    message: 'mcdev validation crashed: ' + (ex?.message || String(ex)),
                    line: 1,
                    column: 1,
                },
            ];
        }
        return results.map((message) => ({
            ruleId: message.ruleId,
            severity: message.severity,
            message: message.message,
            line: message.line,
            column: message.column,
        }));
    },
};
