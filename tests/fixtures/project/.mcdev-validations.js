'use strict';

/**
 * Minimal fixture custom-validation file used by the test-suite. It mirrors the shape of a
 * real project's .mcdev-validations.js: a single exported `validation()` returning a rule list
 * keyed by rule name. Only the rules the tests assert on are implemented here.
 *
 * @param {object} definition mcdev type definition (has type, keyField, nameField)
 * @param {object} item parsed metadata item
 * @param {string} targetDir retrieve/<cred>/<bu>
 * @param {object[]|null} codeExtractItemArr extracted asset code snippets
 * @param {object} Util mcdev Util (logger etc.)
 * @returns {object} validation rule list
 */
export function validation(definition, item, targetDir, codeExtractItemArr, Util) {
    const buSuffixMap = { DEV: '_DEV', Randstad_EUN: '_RS' };
    const targetDirParts = targetDir.includes('/') ? targetDir.split('/') : targetDir.split('\\');
    const bu = targetDirParts.pop() || '';
    const suffix = buSuffixMap[bu];

    return {
        keySuffix: {
            failedMsg: 'Key Suffix expected but not found: ' + suffix,
            /** @returns {boolean} passed */
            passed: function () {
                const relevantTypes = ['asset', 'dataExtension', 'journey'];
                if (!relevantTypes.includes(definition.type) || suffix === undefined) {
                    return true;
                }
                const key = item[definition.keyField] + '';
                return key.endsWith(suffix);
            },
        },
        onlyCBbyKey: {
            failedMsg: 'ContentBlockById/ByName not allowed.',
            /** @returns {boolean} passed */
            passed: function () {
                if (definition.type !== 'asset' || !Array.isArray(codeExtractItemArr)) {
                    return true;
                }
                for (const codeExtractItem of codeExtractItemArr) {
                    const lowered = codeExtractItem.content.toLowerCase();
                    if (
                        lowered.includes('contentblockbyid') ||
                        lowered.includes('contentblockbyname')
                    ) {
                        return false;
                    }
                }
                return true;
            },
        },
        throwsOnPurpose: {
            failedMsg: 'should never be shown',
            /** @returns {boolean} passed */
            passed: function () {
                if (item.__triggerThrow) {
                    Util.logger?.debug?.('about to throw');
                    throw new Error('intentional rule failure');
                }
                return true;
            },
        },
    };
}
