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

/** Issue d'une requête de l'éditeur SQL. */
export type SqlHistoryStatus = "ok" | "error";

/**
 * Requête exécutée depuis l'éditeur SQL, telle que conservée dans l'historique.
 *
 * Le résultat est stocké sous forme structurée et non comme un libellé déjà
 * formaté : l'historique survit à un changement de langue.
 */
export interface SqlHistoryEntry {
    /** Requête telle qu'exécutée. */
    query: string;
    /** Horodatage de l'exécution (ms depuis l'epoch). */
    executedAt: number;
    /** Issue de l'exécution. */
    status: SqlHistoryStatus;
    /** La requête a produit un jeu de lignes (SELECT) plutôt qu'une mutation. */
    isSelect: boolean;
    /** Lignes retournées (SELECT) ou affectées (mutation). */
    rows: number;
    /** Durée d'exécution rapportée par le driver, `null` si inconnue. */
    durationMs: number | null;
    /** Message d'erreur, `null` si la requête a abouti. */
    error: string | null;
}

/** Entrée de l'historique prête à l'affichage dans le panneau de l'éditeur. */
export interface SqlHistoryItemView {
    /** Entrée d'origine, rechargée dans l'éditeur au clic. */
    entry: SqlHistoryEntry;
    /** Requête ramenée à une ligne. */
    compactQuery: string;
    /** Heure d'exécution (HH:MM). */
    time: string;
    /** Résultat : « 23 lignes · 6 ms », « 1 ligne(s) affectée(s) » ou le message d'erreur. */
    result: string;
}
