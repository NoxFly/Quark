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
 * Sites interrogés pour l'heure, dans l'ordre. Leur en-tête HTTP `Date` est
 * exact à la seconde et toujours présent ; les API d'heure publiques, elles,
 * sont souvent indisponibles.
 */
const TIME_SOURCES = ["https://www.cloudflare.com", "https://www.google.com", "https://www.microsoft.com"];

const TIME_REQUEST_TIMEOUT_MS = 5_000;

/** Aucune source d'heure n'a répondu. */
export class OnlineClockUnavailableError extends Error {
    public constructor() {
        super("The current time could not be checked online");
    }
}

/** Récupère une réponse HTTP ; injectable pour les tests. */
export type HeadRequest = (url: string) => Promise<{ headers: { get(name: string): string | null } }>;

const defaultHead: HeadRequest = url => fetch(url, {
    method: "HEAD",
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(TIME_REQUEST_TIMEOUT_MS),
});

/**
 * Heure courante vérifiée en ligne, indépendante de l'horloge du poste : avancer
 * ou reculer celle-ci ne prolonge pas un partage.
 *
 * L'instant est absolu (UTC) : le fuseau du poste comme celui de la base n'y
 * changent rien.
 * @returns L'horodatage courant, en millisecondes.
 * @throws OnlineClockUnavailableError si aucune source ne répond.
 */
export async function fetchOnlineTime(head: HeadRequest = defaultHead): Promise<number> {
    for (const url of TIME_SOURCES) {
        try {
            const sentAt = Date.now();
            const response = await head(url);
            const date = Date.parse(response.headers.get("date") ?? "");

            if (Number.isFinite(date)) {
                // L'en-tête est arrondi à la seconde et daté de l'envoi de la
                // réponse : la moitié de l'aller-retour le rapproche de l'instant présent.
                return date + Math.round((Date.now() - sentAt) / 2);
            }
        }
        catch {
            // Source suivante.
        }
    }

    throw new OnlineClockUnavailableError();
}
