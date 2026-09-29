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
 * Types partagés du diff de session.
 *
 * Le diff couvre TOUTES les modifications faites depuis l'ouverture de la
 * connexion, indépendamment du mode transaction. Il est agrégé par ligne, à la
 * manière d'un `git diff` : deux éditions successives du même champ donnent une
 * seule entrée « valeur à l'ouverture → valeur actuelle », et une modification
 * annulée disparaît du diff au lieu d'y laisser deux entrées qui s'annulent.
 */

import type { DbRecord } from "./types";

/** Nature du changement net subi par une ligne pendant la session. */
export type SessionChangeKind = "insert" | "update" | "delete";

/** État agrégé d'une ligne modifiée pendant la session. */
export interface SessionRowDiff {
    /** Identifiant de la ligne (rowid). */
    rowid: number;
    /** Nature du changement net. */
    kind: SessionChangeKind;
    /** Image de la ligne à sa première modification. `null` si elle a été insérée pendant la session. */
    before: DbRecord | null;
    /** Image courante de la ligne. `null` si elle a été supprimée pendant la session. */
    after: DbRecord | null;
    /** Colonnes dont la valeur diffère entre `before` et `after`. Vide pour un insert ou un delete. */
    changedColumns: string[];
    /** Horodatage de la première modification. */
    firstChangedAt: number;
    /** Horodatage de la dernière modification. */
    lastChangedAt: number;
}

/** Regroupement des lignes modifiées d'une même table. */
export interface SessionTableDiff {
    /** Nom de la table. */
    table: string;
    /** Lignes modifiées, triées par ordre de première modification. */
    rows: SessionRowDiff[];
    /** Nombre de lignes insérées. */
    inserted: number;
    /** Nombre de lignes modifiées. */
    updated: number;
    /** Nombre de lignes supprimées. */
    deleted: number;
}

/**
 * Opération dont l'effet ligne à ligne n'est pas capturé : SQL brut de l'éditeur,
 * DDL, import de masse, suppression en lot au-delà du seuil de détail.
 */
export interface SessionOpaqueChange {
    /** Identifiant d'affichage, unique dans la session. */
    id: number;
    /** Horodatage de l'opération. */
    at: number;
    /** Catégorie affichée (`sql`, `schema`, `import`, `bulk`). */
    category: SessionOpaqueCategory;
    /** Résumé court de l'opération. */
    label: string;
    /** Détail technique (instruction SQL, description du DDL). */
    detail: string;
    /** Table concernée, si identifiable. */
    table: string | null;
    /** Nombre de lignes affectées si le driver le rapporte. */
    rowsAffected: number | null;
}

/** Catégorie d'une opération non détaillée. */
export type SessionOpaqueCategory = "sql" | "schema" | "import" | "bulk";

/** Compteurs du diff, suffisants pour un badge sans transporter tout le contenu. */
export interface SessionDiffSummary {
    /** Nombre de tables touchées. */
    tables: number;
    /** Nombre de lignes modifiées, toutes tables confondues. */
    rows: number;
    /** Nombre d'opérations non détaillées. */
    opaque: number;
}

/** Instantané complet du diff de session. */
export interface SessionDiffSnapshot {
    /** Une connexion est ouverte et suivie. */
    active: boolean;
    /** Horodatage d'ouverture de la session, `null` si aucune connexion. */
    startedAt: number | null;
    /** Chemin ou URI de la source suivie. */
    source: string | null;
    /** Tables modifiées, triées par ordre de première modification. */
    tables: SessionTableDiff[];
    /** Opérations non détaillées, de la plus récente à la plus ancienne. */
    opaque: SessionOpaqueChange[];
    /** Compteurs agrégés. */
    summary: SessionDiffSummary;
    /**
     * Le plafond de lignes suivies a été atteint : des modifications
     * postérieures ne sont pas détaillées.
     */
    capped: boolean;
}
