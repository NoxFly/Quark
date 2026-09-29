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



const fs = require("node:fs");
const path = require("node:path");

/** Profondeur maximale d'exploration d'un paquet à la recherche d'un binaire natif. */
const MAX_LOOKUP_DEPTH = 4;

/**
 * @description Parcourt le graphe des dépendances de production. Les devDependencies
 * ne sont jamais copiées par electron-builder : les inclure ne ferait que produire
 * des globs `asarUnpack` sans cible.
 * @param {string} projectDir Racine du projet.
 * @returns {string[]} Noms des paquets de production installés à plat.
 */
function collectProductionPackages(projectDir) {
    const rootManifest = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"));
    const queue = Object.keys(rootManifest.dependencies ?? {});
    const resolved = new Set();

    while (queue.length > 0) {
        const packageName = queue.pop();

        if (resolved.has(packageName)) {
            continue;
        }

        const manifestPath = path.join(projectDir, "node_modules", packageName, "package.json");

        if (!fs.existsSync(manifestPath)) {
            continue;
        }

        resolved.add(packageName);

        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        queue.push(...Object.keys(manifest.dependencies ?? {}));
    }

    return [...resolved];
}

/**
 * @description Cherche un fichier `.node` dans un paquet, sans redescendre dans les
 * `node_modules` imbriqués (ceux-ci sont traités comme des paquets à part entière).
 * @param {string} directory Répertoire à explorer.
 * @param {number} depth Profondeur restante.
 * @returns {boolean} `true` dès qu'un binaire natif est trouvé.
 */
function containsNativeBinary(directory, depth) {
    if (depth < 0) {
        return false;
    }

    let entries;

    try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
    }
    catch {
        return false;
    }

    const subdirectories = [];

    for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".node")) {
            return true;
        }

        if (entry.isDirectory() && entry.name !== "node_modules") {
            subdirectories.push(path.join(directory, entry.name));
        }
    }

    return subdirectories.some(subdirectory => containsNativeBinary(subdirectory, depth - 1));
}

/**
 * @description Construit les globs `asarUnpack` des modules natifs. Un module natif
 * doit rester sur le disque : son `.node` ne peut pas être chargé depuis l'archive
 * asar, et beaucoup résolvent leur binaire par chemin relatif au paquet.
 *
 * La détection se fait sur la présence réelle d'un `.node` plutôt que sur celle d'un
 * `binding.gyp` : cela capte les paquets livrés préconstruits (oracledb) et écarte
 * ceux qui embarquent un gyp sans jamais produire de binaire.
 * @param {string} projectDir Racine du projet.
 * @returns {string[]} Globs à passer à `asarUnpack`.
 */
function resolveNativeModuleGlobs(projectDir) {
    const packages = collectProductionPackages(projectDir);
    const nativePackages = packages
        .filter(packageName => containsNativeBinary(path.join(projectDir, "node_modules", packageName), MAX_LOOKUP_DEPTH))
        .sort();

    console.info("Modules natifs détectés pour asarUnpack :");
    console.info(nativePackages.map(packageName => `- ${packageName}`).join("\n"));

    return nativePackages.map(packageName => `**/node_modules/${packageName}/**/*`);
}

module.exports = {
    resolveNativeModuleGlobs,
};
