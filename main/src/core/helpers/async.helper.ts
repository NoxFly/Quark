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

import { Logger } from "@noxfly/noxus/main";

/**
 * Borne la durée d'une opération asynchrone et retourne une valeur de repli
 * si l'échéance est dépassée.
 *
 * Utilisé sur les chemins de démarrage : un driver qui ne répond jamais
 * (base réseau injoignable, fichier sur un partage réseau coupé) bloquerait
 * sinon indéfiniment l'initialisation du renderer, qui resterait masqué
 * derrière son écran de chargement plein écran.
 *
 * @param operation - Opération à borner.
 * @param timeoutMs - Échéance en millisecondes.
 * @param fallbackValue - Valeur retournée si l'échéance est dépassée.
 * @param label - Libellé utilisé dans le log d'avertissement.
 * @returns Le résultat de l'opération, ou `fallbackValue` en cas de dépassement.
 * @example
 * const schema = await withTimeout(driver.getSchema(), 8000, null, "getSchema");
 */
export async function withTimeout<T>(
    operation: Promise<T>,
    timeoutMs: number,
    fallbackValue: T,
    label: string,
): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const deadline = new Promise<T>(resolve => {
        timer = setTimeout(() => {
            Logger.warn(`"${label}" timed out after ${timeoutMs}ms — using fallback value.`);
            resolve(fallbackValue);
        }, timeoutMs);
    });

    try {
        return await Promise.race([operation, deadline]);
    }
    finally {
        clearTimeout(timer);
    }
}
