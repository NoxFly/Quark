/*
 * Quark
 * Copyright (C) 2026 NoxFly
 *
 * FR : Ce programme est un logiciel libre ; vous pouvez le redistribuer ou le
 * modifier selon les termes de la GNU Affero General Public License, version 3,
 * telle que publiée par la Free Software Foundation. Il est distribué dans
 * l'espoir d'être utile, mais SANS AUCUNE GARANTIE. Voir le fichier LICENSE.
 *
 * EN : This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License, version 3, as
 * published by the Free Software Foundation. It is distributed in the hope that
 * it will be useful, but WITHOUT ANY WARRANTY. See the LICENSE file.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const { resolve } = require("node:path");
const { defineConfig } = require("tsup");

const mode = process.env.NODE_ENV ?? "development";
const isDev = mode === "development" || mode === "debug";

const aliases = {
    "src": resolve(__dirname, "main/src"),
    "@shared": resolve(__dirname, "shared"),
};

module.exports = defineConfig([
    {
        entry: { main: "main/src/index.ts" },
        format: ["cjs"],
        target: "es2020",
        outDir: "dist",
        // Le main n'embarque plus aucun client de base : ils vivent dans l'hôte.
        external: ["electron"],
        sourcemap: isDev,
        clean: true,
        keepNames: true,
        // No need for splitting - lazy imports are real dynamic imports
        splitting: false,
        esbuildOptions(options) {
            options.alias = aliases;
        },
        env: {
            NODE_ENV: mode,
            // Dépôt GitHub interrogé par le système de mise à jour. Fourni par la CI
            // (`${{ github.repository }}`) pour qu'un fork serve ses propres releases.
            UPDATE_REPOSITORY: process.env.UPDATE_REPOSITORY ?? "NoxFly/quark",
        },
    },
    {
        // Hôte des drivers, exécuté dans un utilityProcess par fenêtre.
        entry: { "driver-host": "main/src/driver-host.ts" },
        format: ["cjs"],
        target: "es2022",
        outDir: "dist",
        // Module natif : chargé depuis node_modules (décompressé hors de l'asar).
        external: ["electron", "better-sqlite3-multiple-ciphers"],
        sourcemap: isDev,
        keepNames: true,
        splitting: false,
        esbuildOptions(options) {
            options.alias = aliases;
        },
        env: {
            NODE_ENV: mode,
        },
    },
    {
        entry: { preload: "main/src/preload.ts" },
        format: ["cjs"],          // preload = CommonJS obligatoirement
        target: "es2020",
        outDir: "dist",
        external: ["electron"],
        // Un preload sandboxé ne peut `require` que les modules d'Electron :
        // Noxus doit être inclus dans le bundle, que tsup externaliserait sinon
        // comme toute dépendance du package.json.
        noExternal: ["@noxfly/noxus"],
        bundle: true,
        sourcemap: isDev,
        keepNames: true,
        esbuildOptions(options) {
            options.alias = aliases;
        },
    },
]);
