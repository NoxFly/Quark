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
 * Formulations d'une violation de clé étrangère selon le moteur : SQLite
 * (« FOREIGN KEY constraint failed »), MySQL / MariaDB (« a foreign key constraint
 * fails », `ER_ROW_IS_REFERENCED`), PostgreSQL (« violates foreign key
 * constraint »), SQL Server (« conflicted with the REFERENCE constraint »),
 * Oracle (`ORA-02292`, « child record found »).
 */
const FOREIGN_KEY_ERROR =
    /foreign key constraint|ER_ROW_IS_REFERENCED|ER_NO_REFERENCED_ROW|REFERENCE constraint|ORA-02292|child record found/i;

/**
 * Indique si une erreur de base de données est une violation de clé étrangère.
 *
 * @param error - Erreur rattrapée.
 * @returns `true` si la ligne est référencée ailleurs et ne peut être supprimée telle quelle.
 */
export function isForeignKeyError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);

    return FOREIGN_KEY_ERROR.test(message);
}
