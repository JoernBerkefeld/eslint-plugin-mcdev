'use strict';
import { mcdevProcessor } from './processor.js';

/**
 * The eslint-plugin-mcdev plugin object. `configs.recommended` references this same object
 * (standard flat-config self-reference), so it is assembled in a single literal.
 *
 * @type {{meta: object, processors: object, configs: object}}
 */
const plugin = {
    meta: {
        name: 'eslint-plugin-mcdev',
        version: '0.1.0',
    },
    processors: {
        mcdev: mcdevProcessor,
    },
    configs: {
        /**
         * Flat-config preset: run mcdev metadata validation on retrieve/ and deploy/ *-meta.json
         * files. Consumers can override the validation method via the MCDEV_VALIDATION_METHOD env
         * var ("retrieve" | "buildDefinition" | "deploy"; default "deploy").
         */
        recommended: [
            {
                files: ['**/retrieve/**/*-meta.json', '**/deploy/**/*-meta.json'],
                // `plugins.mcdev` is filled in below to point at this same plugin object.
                plugins: {},
                processor: 'mcdev/mcdev',
            },
        ],
    },
};

plugin.configs.recommended[0].plugins.mcdev = plugin;

export default plugin;
