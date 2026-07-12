'use strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * @typedef {Object.<string, string>} ValidationConfig map of ruleName -> severity ("off"|"warn"|"error"|"fix")
 */

const RC_FILENAME = '.mcdevrc.json';

/** @type {Map.<string, {dir: string, config: object}|null>} cache keyed by start directory */
const rcCache = new Map();

/**
 * Walks up from a starting path to locate the nearest .mcdevrc.json.
 *
 * @param {string} startPath file or directory to start searching from
 * @returns {{dir: string, config: object}|null} the parsed rc + its directory, or null when not found
 */
export function findMcdevrc(startPath) {
    let directory = path.resolve(startPath);
    if (fs.existsSync(directory) && fs.statSync(directory).isFile()) {
        directory = path.dirname(directory);
    }
    if (rcCache.has(directory)) {
        return rcCache.get(directory);
    }
    let current = directory;
    let hasReachedRoot = false;
    while (!hasReachedRoot) {
        const candidate = path.join(current, RC_FILENAME);
        if (fs.existsSync(candidate)) {
            let config;
            try {
                config = JSON.parse(fs.readFileSync(candidate, 'utf8'));
            } catch {
                config = {};
            }
            const found = { dir: current, config };
            rcCache.set(directory, found);
            return found;
        }
        const parent = path.dirname(current);
        hasReachedRoot = parent === current;
        current = parent;
    }
    rcCache.set(directory, null);
    return null;
}

/**
 * Clears the internal .mcdevrc.json cache (useful for tests).
 *
 * @returns {void}
 */
export function clearRcCache() {
    rcCache.clear();
}

/**
 * Resolves the effective per-rule validation config for a given method + type, mirroring
 * mcdev's MetadataType.validation() override-merge logic (see sfmc-devtools MetadataType.js).
 *
 * @param {object} rcConfig parsed .mcdevrc.json content
 * @param {'retrieve'|'buildDefinition'|'deploy'} method validation method to read
 * @param {string} type mcdev metadata type used to apply overrides
 * @returns {ValidationConfig|null} merged rule->severity map, or null when no config exists for the method
 */
export function getValidationConfig(rcConfig, method, type) {
    const methodConfig = rcConfig?.options?.validation?.[method];
    if (!methodConfig) {
        return null;
    }
    // deep clone so we can mutate safely
    const validationConfig = structuredClone(methodConfig);

    const overrides = Array.isArray(validationConfig.overrides)
        ? validationConfig.overrides
        : validationConfig.overrides
          ? [validationConfig.overrides]
          : [];
    if (validationConfig.overrides) {
        delete validationConfig.overrides;
        for (const override of overrides) {
            if (
                override?.type?.includes(type) &&
                override.options &&
                Object.keys(override.options).length
            ) {
                Object.assign(validationConfig, override.options);
            }
        }
    }
    return validationConfig;
}
