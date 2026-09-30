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

const { applyElectronFuses } = require("./main/scripts/flip-fuses");
const { createFilePatterns } = require("./main/scripts/package-files");
const { resolveNativeModuleGlobs } = require("./main/scripts/resolve-native-modules");
const pkg = require("./package.json");

const windowsIconPath = "dist/browser/favicon.ico";
const linuxIconPath = "dist/browser/app-logo/app-logo-fill-512.png";

// On supprime les substring au format "+xxxx." ou "-xxxx." pour la version
const version = pkg.version.replace(/([+-]\w+)\./g, ".");
const productName = pkg.productName.replace(/\s+/g, "");
// `${ext}` est une macro d'electron-builder : il la résout lui-même, d'où l'échappement.
const installerFilename = `${productName}-${version}-Setup.\${ext}`;
// Nom distinct de l'installeur : le manifeste de mise à jour retient `*Setup*.exe`,
// la version portable ne doit pas être prise pour lui.
const portableFilename = `${productName}-${version}-Portable.\${ext}`;
const appPackageName = productName.toLowerCase();

const publisher = (pkg.author?.name || "").toLowerCase().replace(/\s+/g, "");

/** @type {import("electron-builder").Configuration} */
module.exports = {
    electronVersion: (pkg.devDependencies?.electron || pkg.dependencies?.electron || "41.0.0").replace(/^[~^]/, ""),
    appId: `com.${publisher}.${appPackageName}`,
    productName: pkg.productName,
    npmRebuild: false,
    publish: null,
    artifactName: installerFilename,
    directories: {
        output: "out",
    },
    // L'interface n'est traduite qu'en français et en anglais : les 53 autres
    // traductions de Chromium pèsent 45 Mo pour rien.
    electronLanguages: ["en-US", "fr"],
    files: createFilePatterns(),
    asar: true,
    asarUnpack: [
        "**/*.node",
        ...resolveNativeModuleGlobs(__dirname),
    ],
    fileAssociations: [
        {
            ext: ["db", "sqlite", "sqlite3", "s3db"],
            name: "Quark",
            description: "Database file editor",
            mimeType: "application/x-sqlite3",
            icon: windowsIconPath,
            role: "Editor",
        },
        {
            ext: ["quarkshare"],
            name: "Quark share",
            description: "Shared Quark database connection",
            mimeType: "application/x-quark-share",
            icon: windowsIconPath,
            role: "Viewer",
        },
    ],
    afterPack: applyElectronFuses,
    win: {
        target: [
            {
                target: "nsis",
                arch: ["x64"],
            },
            {
                target: "portable",
                arch: ["x64"],
            },
        ],
        icon: `${windowsIconPath}`,
        artifactName: installerFilename,
    },
    nsis: {
        // Installateur « one-step » : une petite fenêtre avec barre de progression,
        // sans page Suivant/Installer/Terminer. Pas de choix du dossier d'installation
        // dans ce mode (perdu volontairement) — la version portable reste l'option pour
        // qui veut choisir précisément où Quark vit, sans même passer par un installateur.
        oneClick: true,
        perMachine: false,
        allowElevation: false,
        uninstallDisplayName: pkg.productName,
        installerIcon: windowsIconPath,
        uninstallerIcon: windowsIconPath,
    },
    portable: {
        artifactName: portableFilename,
    },
    linux: {
        target: [
            {
                target: "deb",
                arch: ["x64"],
            },
            {
                target: "rpm",
                arch: ["x64"],
            },
        ],
        icon: `${linuxIconPath}`,
        category: "Utility",
        artifactName: installerFilename,
    },
};
