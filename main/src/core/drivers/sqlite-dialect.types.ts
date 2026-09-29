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

/** Effet d'une instruction d'écriture SQLite. */
export interface SqliteRunResult {
    changes: number;
    lastInsertRowid: number;
}

/** Instruction paramétrée, pour les lectures groupées en un aller-retour. */
export interface SqliteStatement {
    sql: string;
    params?: unknown[];
}

/**
 * Import préparé : une instruction d'insertion et les valeurs de chaque ligne,
 * dans l'ordre de ses paramètres. Chaque driver l'exécute atomiquement à sa façon.
 */
export interface SqliteImportPlan {
    sql: string;
    rows: unknown[][];
}
