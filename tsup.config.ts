import { defineConfig } from 'tsup';
import { resolve } from 'node:path';

const mode = process.env.NODE_ENV ?? 'development';
const isDev = mode === 'development' || mode === 'debug';

export default defineConfig([
    {
        entry: { main: 'main/src/index.ts' },
        format: ['cjs'],
        target: 'es2020',
        outDir: 'dist',
        external: ['electron', 'better-sqlite3-multiple-ciphers'],
        sourcemap: isDev,
        clean: true,
        keepNames: true,
        // No need for splitting - lazy imports are real dynamic imports
        splitting: false,
        esbuildOptions(options) {
            options.alias = {
                'src': resolve(__dirname, 'main/src'),
                '@shared': resolve(__dirname, 'shared'),
            };
        },
        env: {
            NODE_ENV: mode,
        },
    },
    {
        entry: { preload: 'main/src/preload.ts' },
        format: ['cjs'],          // preload = CommonJS obligatoirement
        target: 'es2020',
        outDir: 'dist',
        external: ['electron'],   // seul electron est external, pas noxus
        noExternal: ['@noxfly/noxus'],
        bundle: true,             // bundler noxus/preload dedans
        sourcemap: isDev,
        keepNames: true,
        esbuildOptions(options) {
            options.alias = {
                'src': resolve(__dirname, 'main/src'),
                '@shared': resolve(__dirname, 'shared'),
            };
        },
    }
]);
