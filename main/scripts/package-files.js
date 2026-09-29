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



/**
 * Plateformes et architectures pour lesquelles un paquet npm peut embarquer un
 * binaire natif préconstruit. Tout ce qui ne correspond pas à la cible du build
 * est du poids mort dans l'installeur.
 */
const NATIVE_PLATFORMS = ["darwin", "linux", "win32"];
const NATIVE_ARCHITECTURES = ["x64", "arm64", "ia32", "arm"];
/** Suffixes d'ABI accolés au couple plateforme-architecture par napi-rs, prebuild-install, etc. */
const NATIVE_ABI_SUFFIXES = ["", "-gnu", "-musl", "-msvc", "-gnueabihf"];

/**
 * Exclusions indépendantes de la plateforme.
 *
 * electron-builder applique déjà une liste d'exclusions par défaut (README/test/
 * example à la racine des paquets, .github, *.pdb, *.obj…), mais elle s'arrête à
 * la surface. L'essentiel du poids est ailleurs : sourcemaps, sources C/C++ des
 * modules natifs et sources TypeScript des paquets qui publient leurs `src/`.
 */
const BUILD_ARTIFACT_EXCLUSIONS = [
    // Sourcemaps : jamais lues en production, ~24 Mo dans l'asar.
    "!**/*.map",

    // Sources et déclarations TypeScript : Node ne charge que les .js correspondants.
    "!**/node_modules/**/*.{ts,mts,cts}",

    // Sources C/C++ et descripteurs node-gyp : seul le .node compilé sert au runtime.
    // (better-sqlite3-multiple-ciphers embarque 13 Mo d'amalgamation SQLite dans deps/)
    "!**/node_modules/*/deps/**",
    "!**/node_modules/@*/*/deps/**",
    "!**/node_modules/**/*.{c,cc,cpp,cxx,h,hh,hpp,hxx,gyp,gypi}",

    // Résidus de compilation node-gyp / MSBuild laissés par `electron-rebuild`.
    "!**/node_modules/**/build/{Debug,node_gyp_bins}/**",
    "!**/node_modules/**/build/Release/{obj,obj.target,.deps}/**",
    "!**/node_modules/**/build/Release/*.{pdb,ilk,exp,lib,iobj,ipdb,tlog,node.d}",
    "!**/node_modules/**/build/Release/*buildinfo.txt",
    "!**/node_modules/**/build/{Makefile,binding.Makefile,config.gypi,gyp-mac-tool}",
    "!**/node_modules/**/build/*.{mk,vcxproj,vcxproj.filters,sln,props,targets}",

    // Documentation embarquée par les paquets (js-md4 publie 0,9 Mo de polices JSDoc).
    "!**/node_modules/*/{doc,docs,man}/**",
    "!**/node_modules/@*/*/{doc,docs,man}/**",
    "!**/node_modules/**/*.{md,markdown}",
];

/**
 * Paquets installés comme dépendances de production mais jamais chargés.
 *
 * `@libsql/client` dépend du module natif `libsql` (fichiers locaux, réplicas
 * embarqués), qui tire un binaire préconstruit par plateforme (~9 Mo). Quark
 * n'utilise que son client « web » (`@libsql/client/web`, HTTP / WebSocket en JS
 * pur) : le module natif serait du poids mort, et un `.node` de plus à sortir de l'asar.
 */
const UNUSED_PACKAGE_EXCLUSIONS = [
    "!**/node_modules/libsql/**",
    "!**/node_modules/@libsql/{darwin,linux,win32,android,freebsd}-*/**",
];

/**
 * @description Construit la liste des jetons `<plateforme>-<architecture>[-abi]`
 * qui ne correspondent PAS à la cible du build.
 * @param {string} platform Plateforme cible (`process.platform`).
 * @param {string} architecture Architecture cible (`process.arch`).
 * @returns {string[]} Jetons étrangers à exclure.
 */
function collectForeignPlatformTokens(platform, architecture) {
    const tokens = [];

    for (const foreignPlatform of NATIVE_PLATFORMS) {
        for (const foreignArchitecture of NATIVE_ARCHITECTURES) {
            const isTarget = foreignPlatform === platform && foreignArchitecture === architecture;

            if (isTarget) {
                continue;
            }

            for (const abiSuffix of NATIVE_ABI_SUFFIXES) {
                tokens.push(`${foreignPlatform}-${foreignArchitecture}${abiSuffix}`);
            }
        }
    }

    return tokens;
}

/**
 * @description Exclut les binaires natifs préconstruits pour les autres plateformes.
 * `oracledb` publie par exemple les cinq binaires darwin/linux/win32 dans le même
 * paquet : quatre sont inutiles dans un installeur donné.
 * @param {string} platform Plateforme conservée (`process.platform`).
 * @param {string} architecture Architecture conservée (`process.arch`).
 * @returns {string[]} Patterns d'exclusion des binaires étrangers.
 */
function createForeignBinaryExclusions(platform, architecture) {
    const tokens = collectForeignPlatformTokens(platform, architecture);
    const alternatives = `{${tokens.join(",")}}`;

    return [
        // oracledb : build/Release/oracledb-<version>-<plateforme>-<arch>.node
        `!**/node_modules/**/*-${alternatives}.node`,
        `!**/node_modules/**/*-${alternatives}.node-buildinfo.txt`,
        // prebuild-install / node-gyp-build : prebuilds/<plateforme>-<arch>/
        `!**/node_modules/**/prebuilds/${alternatives}/**`,
        // napi-rs & consorts : un paquet par cible, nommé <paquet>-<plateforme>-<arch>
        `!**/node_modules/*-${alternatives}/**`,
        `!**/node_modules/@*/*-${alternatives}/**`,
    ];
}

/**
 * @description Construit le tableau `files` complet d'electron-builder.
 *
 * Tout tient dans un seul tableau, volontairement : electron-builder normalise
 * `config.files` en `[{ filter: [...] }]` et le transforme en un matcher dédié,
 * alors que des `files` déclarés sous `win`/`linux` alimentent un second matcher
 * qui prend la tête de la liste. Ce second matcher ne contenant que des exclusions,
 * electron-builder lui ajoute `**\/*` et embarque le projet entier dans l'asar.
 *
 * Corollaire : les binaires natifs conservés sont ceux de la machine de build, pas
 * ceux de la cible. C'est cohérent avec `electron-rebuild`, qui ne recompile que
 * pour l'hôte — ce projet ne sait de toute façon pas produire un paquet Linux
 * fonctionnel depuis Windows.
 * @param {string} [platform] Plateforme de build.
 * @param {string} [architecture] Architecture de build.
 * @returns {string[]} Patterns `files`.
 */
function createFilePatterns(platform = process.platform, architecture = process.arch) {
    return [
        "dist/**",
        ...BUILD_ARTIFACT_EXCLUSIONS,
        ...UNUSED_PACKAGE_EXCLUSIONS,
        ...createForeignBinaryExclusions(platform, architecture),
    ];
}

module.exports = {
    createFilePatterns,
};
