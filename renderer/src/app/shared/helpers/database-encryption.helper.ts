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

import type { RecentDatabaseEntry } from "@shared/ipc-renderer";

/**
 * Indique si un fichier de base est chiffré, d'après la liste des bases récentes.
 *
 * Le renderer ne garde aucune autre trace du chiffrement : le main note, à chaque
 * ouverture d'un fichier, s'il a fallu un mot de passe (`requiresPassword`).
 *
 * @param recents - Bases récentes, telles que renvoyées par le main.
 * @param filePath - Chemin du fichier ouvert.
 * @returns `true` / `false` si le fichier figure dans la liste, `null` sinon.
 * @example
 * isEncryptedFile([{ connectionType: "file", filePath: "a.db", requiresPassword: true, … }], "a.db"); // true
 */
export function isEncryptedFile(recents: readonly RecentDatabaseEntry[], filePath: string | null): boolean | null {
    if (filePath === null) {
        return null;
    }

    const entry = recents.find(recent => recent.connectionType === "file" && recent.filePath === filePath);

    return entry ? entry.requiresPassword : null;
}
