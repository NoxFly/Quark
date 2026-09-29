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

import type { FieldDef, MutationRecord } from "@shared/types";

/** Largeur de la colonne des numéros de ligne, en pixels. */
export const ROW_NUMBER_COLUMN_WIDTH = 44;

/** Marque de gauche d'une ligne modifiée pendant la session. */
export type RowMark = "inserted" | "modified";

/**
 * Bornes d'un epoch plausible : de 1980 à 2100. La borne basse écarte les
 * petits entiers (identifiants, quantités) qui tomberaient sinon en 1970.
 */
const EPOCH_MIN_SECONDS = 315_532_800;
const EPOCH_MAX_SECONDS = 4_102_444_800;
const EPOCH_MIN_MS = EPOCH_MIN_SECONDS * 1000;
const EPOCH_MAX_MS = EPOCH_MAX_SECONDS * 1000;

/**
 * Noms de colonnes qui annoncent un horodatage : suffixes `_le`, `_at`, `_on`,
 * `_ts`, ou mots-clés usuels (created, updated, date, time…).
 */
const TIMESTAMP_NAME_PATTERN = /(^|_)(le|at|on|ts)$|date|time|created|updated|modified|deleted|expire|birth|login|epoch/i;

/** Types textuels : largeur flexible, police proportionnelle. */
const TEXT_TYPE_PATTERN = /char|text|clob|string|json|xml|uuid|enum/i;

/** Types textuels dont les valeurs sont typiquement longues. */
const LONG_TEXT_TYPE_PATTERN = /^(text|ntext|clob|nclob|longtext|mediumtext|json|jsonb|xml|string)$/i;

/** Seuil au-delà duquel un `VARCHAR(n)` est traité comme un texte long. */
const LONG_VARCHAR_LENGTH = 255;

/**
 * Indique si un type SQL (ou MongoDB) est entier : seul cas où une valeur peut
 * être un epoch.
 * @param type - Type déclaré de la colonne.
 */
export function isIntegerType(type: string): boolean {
    return /int|^number$|^long$|^numeric$/i.test(type.trim());
}

/**
 * Indique si un type est textuel. Un type vide (colonne SQLite sans type) est
 * considéré textuel : c'est l'affinité la plus fréquente de ces colonnes.
 * @param type - Type déclaré de la colonne.
 */
export function isTextType(type: string): boolean {
    const trimmed = type.trim();
    return trimmed === "" || TEXT_TYPE_PATTERN.test(trimmed);
}

/**
 * Indique si un type textuel contient en général de longs textes.
 * @param type - Type déclaré de la colonne.
 */
export function isLongTextType(type: string): boolean {
    const trimmed = type.trim();

    if (LONG_TEXT_TYPE_PATTERN.test(trimmed)) {
        return true;
    }

    const length = /char\s*\(\s*(\d+)\s*\)/i.exec(trimmed)?.[1];
    return length !== undefined && Number(length) > LONG_VARCHAR_LENGTH;
}

/**
 * Unité d'un epoch plausible, `null` si la valeur n'en est pas un.
 * @param value - Valeur brute de la cellule.
 */
export function epochUnit(value: unknown): "s" | "ms" | null {
    const numeric = typeof value === "number" ? value : (typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN);

    if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) {
        return null;
    }

    if (numeric >= EPOCH_MIN_SECONDS && numeric <= EPOCH_MAX_SECONDS) {
        return "s";
    }

    if (numeric >= EPOCH_MIN_MS && numeric <= EPOCH_MAX_MS) {
        return "ms";
    }

    return null;
}

/**
 * Indique si le nom d'une colonne évoque un horodatage.
 * @param name - Nom de la colonne.
 */
export function hasTimestampName(name: string): boolean {
    return TIMESTAMP_NAME_PATTERN.test(name);
}

/**
 * Indique si une colonne entière contient vraisemblablement des epochs.
 *
 * Un nom évocateur suffit si les valeurs ne le contredisent pas (toutes dans la
 * plage plausible, en secondes ou millisecondes). Sans nom évocateur, seules les
 * millisecondes sont retenues : en secondes, la plage couvre aussi des entiers
 * courants (numéros de téléphone, codes), et le bouton serait proposé à tort.
 *
 * @param field - Définition de la colonne.
 * @param samples - Valeurs déjà chargées de la colonne (les `null` sont ignorés).
 */
export function isTimestampCandidate(field: FieldDef, samples: readonly unknown[]): boolean {
    if (!isIntegerType(field.type) || field.pk || field.fk) {
        return false;
    }

    const values = samples.filter(value => value !== null && value !== undefined && value !== "");
    const units = values.map(epochUnit);

    if (hasTimestampName(field.name)) {
        return units.every(unit => unit !== null);
    }

    return units.length > 0 && units.every(unit => unit === "ms");
}

/**
 * Formate un epoch en date et heure locales (`jj/mm/aaaa hh:mm` en français).
 * Retourne `null` si la valeur n'est pas un epoch plausible.
 * @param value - Valeur brute (secondes ou millisecondes).
 * @param locale - Locale d'affichage.
 */
export function formatEpoch(value: unknown, locale: string): string | null {
    const unit = epochUnit(value);

    if (unit === null) {
        return null;
    }

    const numeric = Number(value);
    const date = new Date(unit === "s" ? numeric * 1000 : numeric);
    const day = date.toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" });
    const time = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false });

    return `${day} ${time}`;
}

/**
 * Largeur minimale d'une colonne, en pixels, selon son type.
 * @param field - Définition de la colonne.
 */
export function columnMinWidth(field: FieldDef): number {
    if (!isTextType(field.type)) {
        return 130;
    }

    return isLongTextType(field.type) ? 280 : 160;
}

/**
 * Piste CSS Grid d'une colonne : fixe si l'utilisateur l'a redimensionnée,
 * sinon flexible avec un minimum dépendant du type.
 * @param field - Définition de la colonne.
 * @param resizedWidth - Largeur choisie par l'utilisateur, en pixels.
 */
export function columnTrack(field: FieldDef, resizedWidth?: number): string {
    if (resizedWidth !== undefined) {
        return `${resizedWidth}px`;
    }

    if (!isTextType(field.type)) {
        return "minmax(130px, 0.7fr)";
    }

    return isLongTextType(field.type) ? "minmax(280px, 2fr)" : "minmax(160px, 1fr)";
}

/**
 * `grid-template-columns` complet de la grille, colonne des numéros comprise.
 * @param fields - Colonnes affichées.
 * @param widths - Largeurs choisies par l'utilisateur, par nom de colonne.
 */
export function gridTemplateColumns(fields: readonly FieldDef[], widths: ReadonlyMap<string, number>): string {
    return [`${ROW_NUMBER_COLUMN_WIDTH}px`, ...fields.map(field => columnTrack(field, widths.get(field.name)))].join(" ");
}

/**
 * Largeur minimale totale de la grille. Elle est calculée plutôt que laissée à
 * `max-content` : avec la virtualisation, le contenu rendu change au défilement
 * et la largeur de la grille (donc des colonnes) varierait avec lui.
 * @param fields - Colonnes affichées.
 * @param widths - Largeurs choisies par l'utilisateur, par nom de colonne.
 */
export function gridMinWidth(fields: readonly FieldDef[], widths: ReadonlyMap<string, number>): number {
    return fields.reduce((total, field) => total + (widths.get(field.name) ?? columnMinWidth(field)), ROW_NUMBER_COLUMN_WIDTH);
}

/**
 * Marques des lignes d'une table modifiées pendant la session, déduites de
 * l'historique des mutations. Une ligne insérée puis modifiée reste « insérée ».
 * @param history - Mutations enregistrées, dans l'ordre.
 * @param table - Table affichée.
 */
export function rowMarksFromHistory(history: readonly MutationRecord[], table: string): Map<number, RowMark> {
    const marks = new Map<number, RowMark>();

    for (const mutation of history) {
        if (mutation.table !== table) {
            continue;
        }

        if (mutation.type === "insert") {
            marks.set(mutation.rowid, "inserted");
        }
        else if (mutation.type === "update" && !marks.has(mutation.rowid)) {
            marks.set(mutation.rowid, "modified");
        }
        else if (mutation.type === "delete") {
            marks.delete(mutation.rowid);
        }
    }

    return marks;
}
