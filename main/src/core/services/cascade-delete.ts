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

import type { DatabaseDriver } from "src/core/drivers/driver.interface";

/**
 * Suppression à effectuer sur une table dans le cadre d'une cascade.
 */
export interface CascadeStep {
    table: string;
    rowids: number[];
}

/**
 * Clé étrangère vue depuis la table référencée.
 */
interface Referrer {
    table: string;
    column: string;
    referencedColumn: string;
}

/** Nombre de valeurs par requête de recherche, sous la limite de variables de SQLite. */
const LOOKUP_CHUNK_SIZE = 500;

/**
 * Calcule les suppressions à enchaîner pour retirer des lignes et tout ce qui les
 * référence, directement ou non, par clé étrangère.
 *
 * Les étapes sont ordonnées enfants d'abord : chacune peut être exécutée dans
 * l'ordre sans violer de contrainte. Une ligne n'est visitée qu'une fois, ce qui
 * protège des références circulaires ou d'une table qui se référence elle-même.
 *
 * @param driver - Driver de la base.
 * @param table - Table des lignes à supprimer.
 * @param rowids - Identifiants des lignes à supprimer.
 * @returns Les suppressions à effectuer, la dernière étant celle demandée.
 */
export async function planCascadeDelete(
    driver: Pick<DatabaseDriver, "getSchema" | "getRow" | "findRowids">,
    table: string,
    rowids: number[],
): Promise<CascadeStep[]> {
    const schema = await driver.getSchema();
    const referrers = new Map<string, Referrer[]>();

    for (const candidate of schema.tables) {
        for (const field of candidate.fields) {
            if (!field.fk) {
                continue;
            }

            const list = referrers.get(field.fk.table) ?? [];

            list.push({ table: candidate.name, column: field.name, referencedColumn: field.fk.column });
            referrers.set(field.fk.table, list);
        }
    }

    const visited = new Map<string, Set<number>>();
    const steps: CascadeStep[] = [];

    const collect = async (current: string, ids: number[]): Promise<void> => {
        const seen = visited.get(current) ?? new Set<number>();
        const fresh = ids.filter(id => !seen.has(id));

        if (fresh.length === 0) {
            return;
        }

        for (const id of fresh) {
            seen.add(id);
        }

        visited.set(current, seen);

        for (const referrer of referrers.get(current) ?? []) {
            const values = new Set<unknown>();

            for (const id of fresh) {
                const row = await driver.getRow(current, id);
                const value = row?.[referrer.referencedColumn];

                if (value !== null && value !== undefined) {
                    values.add(value);
                }
            }

            const distinct = [...values];

            for (let start = 0; start < distinct.length; start += LOOKUP_CHUNK_SIZE) {
                const chunk = distinct.slice(start, start + LOOKUP_CHUNK_SIZE);
                const childIds = await driver.findRowids(referrer.table, referrer.column, chunk);

                await collect(referrer.table, childIds);
            }
        }

        steps.push({ table: current, rowids: fresh });
    };

    await collect(table, rowids);

    return steps;
}
