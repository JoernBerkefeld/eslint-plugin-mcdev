'use strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * @typedef {object} CodeExtractItem
 * @property {string[]} subFolder path segments below the type folder (mcdev uses [type, subType])
 * @property {string} fileName base file name without extension
 * @property {string} fileExt file extension without leading dot (html/amp/ssjs)
 * @property {string} content raw file content
 */

/**
 * @typedef {object} MetaPathInfo
 * @property {string} type mcdev metadata type (folder right after the BU, e.g. "asset", "journey")
 * @property {string|null} subType optional asset sub type (e.g. "block", "other") parsed from the file name
 * @property {string} bu business unit folder name (last segment of targetDir)
 * @property {string} cred credential folder name (segment before the BU)
 * @property {string} targetDir absolute path up to and including the BU folder (retrieve/<cred>/<bu>)
 * @property {string} key metadata key (file name without the ".<type>[-<subType>]-meta.json" suffix)
 */

const CODE_EXTENSIONS = ['html', 'amp', 'ssjs'];
const META_SUFFIX = '-meta.json';

/**
 * Parses a mcdev "*-meta.json" file path into its mcdev coordinates.
 * Expected layout: <root>/{retrieve|deploy}/<cred>/<bu>/<type>/.../<key>.<type>[-<subType>]-meta.json
 *
 * @param {string} filename absolute or relative path to a *-meta.json file
 * @returns {MetaPathInfo|null} parsed info or null when the path does not match the mcdev layout
 */
export function parseMetaPath(filename) {
    const absolute = path.resolve(filename);
    const base = path.basename(absolute);
    if (!base.endsWith(META_SUFFIX)) {
        return null;
    }
    // strip the "-meta.json" suffix -> "<key>.<type>[-<subType>]"
    const withoutSuffix = base.slice(0, -META_SUFFIX.length);
    const lastDot = withoutSuffix.lastIndexOf('.');
    if (lastDot === -1) {
        return null;
    }
    const key = withoutSuffix.slice(0, lastDot);
    const typeToken = withoutSuffix.slice(lastDot + 1); // "<type>" or "<type>-<subType>"
    const dashIndex = typeToken.indexOf('-');
    const type = dashIndex === -1 ? typeToken : typeToken.slice(0, dashIndex);
    if (!key || !type) {
        return null;
    }
    const subtype = dashIndex === -1 ? null : typeToken.slice(dashIndex + 1);

    // walk the path to find the "<cred>/<bu>/<type>" anchor.
    const segments = absolute.split(path.sep);
    // locate the type folder: the closest ancestor directory whose name equals `type`
    let typeFolderIndex = -1;
    for (let index = segments.length - 2; index >= 1; index--) {
        if (segments[index] === type) {
            typeFolderIndex = index;
            break;
        }
    }
    if (typeFolderIndex < 2) {
        // need at least <cred>/<bu>/<type>
        return null;
    }
    const bu = segments[typeFolderIndex - 1];
    const cred = segments[typeFolderIndex - 2];
    const targetDirectory = segments.slice(0, typeFolderIndex).join(path.sep);

    return { type, subType: subtype, bu, cred, targetDir: targetDirectory, key };
}

/**
 * Collects sibling code files for an asset metadata item into mcdev's codeExtractItemArr shape.
 * Reads any *.html / *.amp / *.ssjs files that share the metadata file's base name, plus any
 * code files nested in a same-named subfolder (webstudio / message layout).
 *
 * @param {string} filename absolute or relative path to the *-meta.json file
 * @param {MetaPathInfo} info parsed metadata path info
 * @returns {CodeExtractItem[]} array of extracted code snippets (empty when none found)
 */
export function collectCodeExtractItems(filename, info) {
    const absolute = path.resolve(filename);
    const directory = path.dirname(absolute);
    const base = path.basename(absolute);
    const stem = base.slice(0, -'.json'.length); // "<key>.<type>[-<subType>]-meta"
    /** @type {CodeExtractItem[]} */
    const result = [];
    const subFolder = info.subType ? [info.type, info.subType] : [info.type];

    // 1) sibling code files sharing the metadata stem (e.g. Foo.asset-block-meta.html)
    for (const extension of CODE_EXTENSIONS) {
        const codePath = path.join(directory, `${stem}.${extension}`);
        if (fs.existsSync(codePath)) {
            result.push({
                subFolder,
                fileName: info.key,
                fileExt: extension,
                content: fs.readFileSync(codePath, 'utf8'),
            });
        }
    }

    // 2) nested code files in a same-named subfolder (webstudio views etc.)
    const nestedDirectory = path.join(directory, info.key);
    if (fs.existsSync(nestedDirectory) && fs.statSync(nestedDirectory).isDirectory()) {
        collectNestedCode(nestedDirectory, [...subFolder, info.key], result);
    }

    return result;
}

/**
 * Recursively reads code files from a nested asset folder.
 *
 * @param {string} directory directory to scan
 * @param {string[]} subFolder accumulated subfolder path for the CodeExtractItem
 * @param {CodeExtractItem[]} result output array (mutated)
 * @returns {void}
 */
function collectNestedCode(directory, subFolder, result) {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            collectNestedCode(full, [...subFolder, entry.name], result);
            continue;
        }
        const extension = path.extname(entry.name).slice(1).toLowerCase();
        if (CODE_EXTENSIONS.includes(extension)) {
            result.push({
                subFolder,
                fileName: entry.name.slice(0, -(extension.length + 1)),
                fileExt: extension,
                content: fs.readFileSync(full, 'utf8'),
            });
        }
    }
}
