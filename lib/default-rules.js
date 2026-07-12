'use strict';

/**
 * mcdev's built-in default validation rules, mirrored synchronously.
 *
 * SOURCE OF TRUTH: sfmc-devtools/lib/util/validations.js (the `defaultRules` object inside
 * the default-exported `validation()` function). mcdev's version is async only because it
 * dynamically imports the project's .mcdev-validations.js; the default rules themselves are
 * synchronous. This copy exists solely so the ESLint processor (which must run synchronously)
 * can evaluate the same defaults. Keep the rule logic and `failedMsg` text in sync with mcdev
 * whenever the mcdev dependency is bumped.
 *
 * Note: mcdev's rules also carry a `fix()` method (`return this.passed() || null`). The ESLint
 * processor only calls `passed()`, so `fix()` is intentionally omitted here to keep the rules
 * plain data objects (autofix is a possible future enhancement).
 *
 * @param {object} definition mcdev type definition (has type, keyField, nameField)
 * @param {object} item parsed metadata item
 * @param {object[]|null} codeExtractItemArray extracted asset code snippets ({ content, ... })
 * @param {object} utility mcdev Util (for logger.debug)
 * @returns {object} rule list ({ ruleName: { failedMsg, passed() } })
 */
export function getDefaultRules(definition, item, codeExtractItemArray, utility) {
    return {
        noGuidKeys: {
            failedMsg: 'Please update the key to a readable value. Currently still in GUID format.',
            passed() {
                const key = item[definition.keyField];
                if (key) {
                    const regex = /^[0-9a-z]{8}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{12}$/i;
                    return !regex.test(String(key).toLowerCase());
                }
                utility.logger?.debug?.('validation-noGuidKeys: key not found');
                return true;
            },
        },
        noRootFolder: {
            failedMsg: 'Root folder not allowed. Current folder: ' + item.r__folder_Path,
            passed() {
                const folderPath = item.r__folder_Path;
                if (!folderPath) {
                    return true;
                }
                const doNotEvaluate = [
                    'automation',
                    'attributeSet',
                    'dataFilter',
                    'list',
                    'filter',
                ];
                if (
                    doNotEvaluate.includes(definition.type) ||
                    (definition.type === 'asset' && item?.assetType?.name === 'webpage') ||
                    (definition.type === 'dataExtension' &&
                        item.r__folder_Path === 'Synchronized Data Extensions')
                ) {
                    return true;
                }
                return folderPath.includes('/');
            },
        },
        noAmpscriptHtmlTag: {
            failedMsg:
                'Please use %%[]%% instead of <script runat="server" language="ampscript"></script> for AMPscript',
            passed() {
                if (definition.type === 'asset' && Array.isArray(codeExtractItemArray)) {
                    for (const codeExtractItem of codeExtractItemArray) {
                        if (
                            codeExtractItem.content.includes(
                                '<script runat="server" language="ampscript">',
                            )
                        ) {
                            return false;
                        }
                    }
                    return true;
                }
                return true;
            },
        },
    };
}
