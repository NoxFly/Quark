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

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Au-delà, une date absolue est plus parlante qu'un « il y a N j ». */
const RELATIVE_DAYS_LIMIT = 7;

/**
 * @description Formate l'ancienneté d'un horodatage de façon compacte, dans la
 * langue de l'interface : « à l'instant », « il y a 5 min », « il y a 2 h »,
 * « hier », « il y a 3 j », puis la date au-delà d'une semaine.
 * Les jours sont comptés en jours calendaires : une base ouverte hier à 23 h
 * est « hier » à minuit passé, pas « il y a 1 h ».
 * @param timestamp Horodatage en millisecondes.
 * @param locale Langue de l'interface (`fr`, `en`).
 * @param now Instant de référence (injectable pour les tests).
 * @returns Libellé relatif.
 * @example formatRelativeTime(Date.now() - 2 * 3_600_000, "fr"); // "il y a 2 h"
 */
export function formatRelativeTime(timestamp: number, locale: string, now: number = Date.now()): string {
    const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
    const elapsed = Math.max(0, now - timestamp);

    if (elapsed < MINUTE_MS) {
        return formatter.format(0, "second");
    }

    if (elapsed < HOUR_MS) {
        const minutes = Math.floor(elapsed / MINUTE_MS);
        return formatter.format(-minutes, "minute");
    }

    const days = calendarDaysBetween(timestamp, now);

    if (days === 0) {
        const hours = Math.floor(elapsed / HOUR_MS);
        return formatter.format(-hours, "hour");
    }

    if (days < RELATIVE_DAYS_LIMIT) {
        return formatter.format(-days, "day");
    }

    return new Date(timestamp).toLocaleDateString(locale);
}

/**
 * Nombre de minuits franchis entre deux instants (heure locale).
 */
function calendarDaysBetween(from: number, to: number): number {
    const start = new Date(from);
    const end = new Date(to);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    const difference = end.getTime() - start.getTime();
    // Arrondi : un changement d'heure décale la différence d'une heure.
    return Math.round(difference / DAY_MS);
}
