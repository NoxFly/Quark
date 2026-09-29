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

export enum AppEnv {
    DEVELOPMENT = "development",
    PRODUCTION = "production",
}

export enum OSType {
    Windows = "Windows",
    MacOS = "MacOS",
    Linux = "Linux",
}

export interface Environment {
    env: AppEnv;
    rootDir: string;
    publicDir: string;
    rendererDir: string;
    os: OSType;
    /**
     * Exécutable d'origine de la version portable Windows, `null` pour une version
     * installée. La version portable s'extrait à chaque lancement dans un dossier
     * temporaire : `process.execPath` y pointe et disparaît à la fermeture.
     */
    portableExecutable: string | null;
    product: {
        name: string;
        displayName: string;
        version: string;
    };
    update: {
        /** Dépôt GitHub au format `owner/repo` qui héberge les releases. */
        repository: string;
        /** URL du manifeste de la dernière version publiée pour cette plateforme. */
        manifestUrl: string;
        /** Page des releases, ouverte quand la mise à jour ne peut être appliquée seule. */
        releasesUrl: string;
    };
}
