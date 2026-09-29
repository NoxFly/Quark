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

import type { SqlHistoryEntry } from "src/app/core/models/sql-history.model";

/** Nombre maximal de requêtes conservées par base. */
export const SQL_HISTORY_LIMIT = 50;

/** Préfixe des clés de stockage de l'historique, une clé par base. */
const STORAGE_KEY_PREFIX = "sql-history:";

/**
 * Retourne la clé de stockage de l'historique d'une base.
 *
 * @param source - Chemin ou adresse identifiant la base.
 * @returns La clé `localStorage` dédiée à cette base.
 * @example
 * historyStorageKey("C:\\data\\shop.db"); // "sql-history:C:\\data\\shop.db"
 */
export function historyStorageKey(source: string): string {
    return `${STORAGE_KEY_PREFIX}${source}`;
}

/**
 * Ajoute une requête en tête de l'historique.
 *
 * Une requête déjà présente est remontée plutôt que dupliquée : relancer la même
 * requête dix fois ne doit pas chasser les autres de l'historique.
 *
 * @param history - Historique courant, du plus récent au plus ancien.
 * @param entry - Requête exécutée.
 * @param limit - Nombre maximal d'entrées conservées.
 * @returns Un nouvel historique, l'original n'est pas modifié.
 */
export function pushHistoryEntry(
    history: readonly SqlHistoryEntry[],
    entry: SqlHistoryEntry,
    limit: number = SQL_HISTORY_LIMIT,
): SqlHistoryEntry[] {
    const others = history.filter(existing => existing.query !== entry.query);
    const next = [entry, ...others];

    return next.slice(0, Math.max(0, limit));
}

/**
 * Relit un historique stocké, en écartant tout ce qui n'a pas la forme attendue.
 *
 * Le stockage peut contenir une version antérieure du format ou avoir été
 * modifié à la main : une entrée invalide est ignorée plutôt que de faire
 * échouer l'ouverture de l'éditeur.
 *
 * @param raw - Contenu brut lu dans le stockage, `null` s'il est absent.
 * @param limit - Nombre maximal d'entrées conservées.
 * @returns Les entrées valides, du plus récent au plus ancien.
 */
export function parseStoredHistory(raw: string | null, limit: number = SQL_HISTORY_LIMIT): SqlHistoryEntry[] {
    if (!raw) {
        return [];
    }

    let parsed: unknown;

    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return [];
    }

    if (!Array.isArray(parsed)) {
        return [];
    }

    return parsed.filter(isHistoryEntry).slice(0, Math.max(0, limit));
}

/**
 * Réduit une requête à une seule ligne pour l'affichage dans la liste.
 *
 * @param query - Requête, éventuellement multiligne.
 * @returns La requête, blancs consécutifs fusionnés.
 * @example
 * compactQuery("SELECT *\n  FROM t"); // "SELECT * FROM t"
 */
export function compactQuery(query: string): string {
    return query.replace(/\s+/g, " ").trim();
}

/**
 * Formate une durée d'exécution.
 *
 * @param ms - Durée en millisecondes.
 * @returns `< 1 ms`, `12.3 ms` ou `1.25 s`.
 */
export function formatExecutionTime(ms: number): string {
    if (ms < 1) {
        return "< 1 ms";
    }

    if (ms < 1000) {
        return `${ms.toFixed(1)} ms`;
    }

    const seconds = ms / 1000;

    return `${seconds.toFixed(2)} s`;
}

/**
 * Vérifie qu'une valeur lue du stockage est une entrée d'historique exploitable.
 */
function isHistoryEntry(value: unknown): value is SqlHistoryEntry {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    const entry = value as Record<string, unknown>;
    const hasValidDuration = entry["durationMs"] === null || typeof entry["durationMs"] === "number";
    const hasValidError = entry["error"] === null || typeof entry["error"] === "string";

    return typeof entry["query"] === "string"
        && typeof entry["executedAt"] === "number"
        && (entry["status"] === "ok" || entry["status"] === "error")
        && typeof entry["isSelect"] === "boolean"
        && typeof entry["rows"] === "number"
        && hasValidDuration
        && hasValidError;
}
