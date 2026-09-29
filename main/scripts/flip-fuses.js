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



const path = require("node:path");
const { flipFuses, FuseV1Options, FuseVersion } = require("@electron/fuses");

/** Extension du binaire Electron produit, par plateforme. */
const BINARY_EXTENSIONS = {
    darwin: ".app",
    linux: "",
    win32: ".exe",
};

/**
 * @description Verrouille les fuses Electron sur le binaire fraîchement packagé.
 * Coupe les portes d'entrée qui permettraient d'exécuter du code arbitraire dans
 * le contexte de l'application (mode Node, NODE_OPTIONS, inspecteur CLI), et
 * refuse de charger une application modifiée hors de l'asar.
 * @param {import("electron-builder").AfterPackContext} context Contexte `afterPack`.
 * @returns {Promise<void>}
 */
async function applyElectronFuses(context) {
    const extension = BINARY_EXTENSIONS[context.electronPlatformName] ?? "";
    const productFilename = context.packager.appInfo.productFilename;
    const electronBinaryPath = path.join(context.appOutDir, productFilename + extension);

    await flipFuses(electronBinaryPath, {
        version: FuseVersion.V1,
        [FuseV1Options.RunAsNode]: false,
        // L'application ne stocke aucun cookie ; sous Linux, les chiffrer
        // solliciterait le trousseau du système au premier lancement.
        [FuseV1Options.EnableCookieEncryption]: false,
        [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
        [FuseV1Options.EnableNodeCliInspectArguments]: false,
        // electron-builder inscrit l'empreinte de l'asar dans l'exécutable Windows
        // avant `afterPack` : un app.asar modifié est alors refusé au lancement.
        // Sans effet sous Linux, où Electron ne sait pas encore la vérifier.
        [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
        // Sans ce fuse, un dossier `resources/app` posé à côté de l'asar serait
        // chargé à sa place, contournant la vérification d'intégrité.
        [FuseV1Options.OnlyLoadAppFromAsar]: true,
    });
}

module.exports = {
    applyElectronFuses,
};
