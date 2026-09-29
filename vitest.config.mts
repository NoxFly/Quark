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

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

/**
 * Tests du main et du code pur du renderer.
 *
 * Ils tournent sous le Node embarqué par Electron (`npm test` pose
 * `ELECTRON_RUN_AS_NODE`) : `better-sqlite3-multiple-ciphers` est compilé par
 * `electron-rebuild` pour l'ABI d'Electron, que le Node du système ne charge pas.
 */
export default defineConfig({
    resolve: {
        alias: [
            { find: /^src\/app\//, replacement: `${root}renderer/src/app/` },
            { find: /^src\//, replacement: `${root}main/src/` },
            { find: /^@shared\//, replacement: `${root}shared/` },
        ],
    },
    test: {
        environment: "node",
        include: ["main/src/**/*.spec.ts", "renderer/src/**/*.spec.ts"],
        pool: "forks",
        testTimeout: 20_000,
    },
});
