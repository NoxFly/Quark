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

import type { ConnectionUriDescription } from "src/app/core/models/driver-presentation.model";

/**
 * @description Décrit une URI de connexion (MongoDB, libSQL…) pour l'affichage :
 * nom de la base (dernier segment du chemin, à défaut l'hôte) et adresse sans
 * identifiants, pour que le mot de passe n'apparaisse ni dans le titre ni dans
 * la barre d'état.
 * @param uri URI saisie par l'utilisateur.
 * @param fallbackName Nom retenu si l'URI ne permet pas d'en déduire un.
 * @returns Nom de la base et adresse affichable.
 * @example
 * describeConnectionUri("mongodb://admin:secret@localhost:27017/boutique?tls=true", "MongoDB");
 * // => { database: "boutique", address: "mongodb://localhost:27017/boutique" }
 */
export function describeConnectionUri(uri: string, fallbackName: string): ConnectionUriDescription {
    const trimmed = uri.trim();

    try {
        const parsed = new URL(trimmed);
        const segments = parsed.pathname.split("/").filter(segment => segment.length > 0);
        const lastSegment = segments.at(-1);
        const database = lastSegment ? decodeURIComponent(lastSegment) : (parsed.hostname || fallbackName);
        const address = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
        return { database, address };
    }
    catch {
        // URI non standard : on n'affiche rien plutôt que de risquer d'exposer un secret.
        return { database: fallbackName, address: fallbackName };
    }
}
