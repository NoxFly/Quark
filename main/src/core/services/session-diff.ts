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

import type {
    SessionDiffSnapshot,
    SessionDiffSummary,
    SessionOpaqueCategory,
    SessionOpaqueChange,
    SessionRowDiff,
    SessionTableDiff,
} from "@shared/session-diff";
import type { DbRecord } from "@shared/types";

/**
 * Plafond de lignes détaillées par session.
 *
 * Le journal vit en mémoire et contient le contenu réel de la base : un import
 * ou une suppression de masse le ferait grossir sans limite. Au-delà, les lignes
 * déjà suivies continuent d'être mises à jour, mais aucune nouvelle n'est
 * ajoutée et `capped` passe à `true`.
 */
const MAX_TRACKED_ROWS = 20_000;

/** Nombre maximal d'entrées non détaillées conservées. */
const MAX_OPAQUE_ENTRIES = 500;

/** Colonnes exclues de la comparaison : elles portent l'identité, pas la donnée. */
const IDENTITY_COLUMNS = new Set(["rowid"]);

/**
 * Journal des modifications d'une session de connexion.
 *
 * Une instance par fenêtre, remise à zéro à chaque ouverture ou fermeture de
 * base. Le journal reste **exclusivement en mémoire** : il contient le contenu
 * réel des lignes, l'écrire sur disque exfiltrerait en clair les données d'une
 * base chiffrée, et le chiffrer imposerait de gérer une clé pour une donnée dont
 * la durée de vie ne dépasse pas la session.
 *
 * L'agrégation est celle d'un `git diff` et non d'un journal chronologique :
 * chaque ligne touchée porte son image d'origine et son image courante. Deux
 * éditions successives du même champ donnent une seule entrée, et une
 * modification annulée disparaît du diff.
 */
export class SessionDiff {
    /** Lignes suivies, indexées par `table` + `rowid` pour un accès direct. */
    private readonly rows = new Map<string, TrackedRow>();
    private readonly opaque: SessionOpaqueChange[] = [];
    private startedAt: number | null = null;
    private source: string | null = null;
    private nextOpaqueId = 1;
    private capped = false;

    /**
     * État des entrées touchées depuis le `BEGIN` courant, dans leur version
     * d'avant la transaction. `null` hors transaction.
     *
     * Un `ROLLBACK` annule réellement les écritures : sans ce filet, le diff
     * continuerait d'afficher des modifications qui n'existent plus en base.
     * Une valeur `null` signale une entrée qui n'existait pas avant la transaction
     * et doit donc disparaître.
     */
    private transactionBackup: Map<string, TrackedRow | null> | null = null;

    /** Nombre d'entrées opaques au moment du `BEGIN`, pour les tronquer au rollback. */
    private opaqueCountAtBegin = 0;

    /**
     * Démarre une nouvelle session de suivi et efface la précédente.
     * @param source - Chemin de fichier ou URI de la connexion suivie.
     */
    public start(source: string | null): void {
        this.reset();
        this.startedAt = Date.now();
        this.source = source;
    }

    /**
     * Efface le journal et met fin au suivi.
     */
    public reset(): void {
        this.rows.clear();
        this.opaque.length = 0;
        this.startedAt = null;
        this.source = null;
        this.nextOpaqueId = 1;
        this.capped = false;
        this.transactionBackup = null;
        this.opaqueCountAtBegin = 0;
    }

    /**
     * Ouvre une borne de transaction : les entrées touchées à partir d'ici
     * pourront être restaurées si la transaction est annulée.
     */
    public beginTransaction(): void {
        this.transactionBackup = new Map();
        this.opaqueCountAtBegin = this.opaque.length;
    }

    /**
     * Valide la transaction : les modifications journalisées deviennent définitives.
     */
    public commitTransaction(): void {
        this.transactionBackup = null;
        this.opaqueCountAtBegin = 0;
    }

    /**
     * Annule la transaction : le journal revient à son état d'avant le `BEGIN`,
     * comme la base elle-même.
     */
    public rollbackTransaction(): void {
        if (!this.transactionBackup) {
            return;
        }

        for (const [key, previous] of this.transactionBackup) {
            if (previous === null) {
                this.rows.delete(key);
                continue;
            }

            this.rows.set(key, previous);
        }

        this.opaque.splice(0, this.opaque.length - this.opaqueCountAtBegin);

        this.transactionBackup = null;
        this.opaqueCountAtBegin = 0;
    }

    /**
     * Indique si une session est en cours de suivi.
     */
    public get isActive(): boolean {
        return this.startedAt !== null;
    }

    /**
     * Indique si la source donnée est déjà suivie par la session courante.
     *
     * Permet de distinguer une réouverture technique (rafraîchissement, saisie du
     * mot de passe) d'une nouvelle connexion : la première doit conserver le
     * journal, la seconde le repartir de zéro.
     *
     * @param source - Chemin ou URI de la connexion.
     */
    public isTracking(source: string | null): boolean {
        return this.isActive && source !== null && this.source === source;
    }

    /**
     * Enregistre la modification d'une ligne existante.
     *
     * `before` n'est retenu qu'à la première modification de la ligne : les
     * suivantes ne déplacent que l'image courante, pour que le diff reste
     * « état à l'ouverture → état actuel ».
     *
     * @param table - Table concernée.
     * @param rowid - Identifiant de la ligne.
     * @param before - Image de la ligne avant l'opération.
     * @param after - Image de la ligne après l'opération.
     */
    public recordUpdate(table: string, rowid: number, before: DbRecord | null, after: DbRecord | null): void {
        this.backupForRollback(keyOf(table, rowid));

        const existing = this.rows.get(keyOf(table, rowid));

        if (!existing) {
            if (!this.canTrackMore()) {
                return;
            }

            this.track(table, rowid, { kind: "update", before, after });
            return;
        }

        existing.after = after;
        existing.lastChangedAt = Date.now();

        this.pruneIfUnchanged(table, rowid, existing);
    }

    /**
     * Enregistre l'insertion d'une ligne.
     * @param table - Table concernée.
     * @param rowid - Identifiant de la ligne créée.
     * @param after - Image de la ligne insérée.
     */
    public recordInsert(table: string, rowid: number, after: DbRecord | null): void {
        this.backupForRollback(keyOf(table, rowid));

        if (!this.canTrackMore()) {
            return;
        }

        // Un rowid réutilisé après suppression écrase l'entrée précédente : sans
        // cela, le diff montrerait une ligne à la fois supprimée et insérée.
        this.track(table, rowid, { kind: "insert", before: null, after });
    }

    /**
     * Enregistre la suppression d'une ligne.
     *
     * Une ligne insérée puis supprimée dans la même session disparaît du diff :
     * son effet net est nul.
     *
     * @param table - Table concernée.
     * @param rowid - Identifiant de la ligne supprimée.
     * @param before - Image de la ligne avant suppression.
     */
    public recordDelete(table: string, rowid: number, before: DbRecord | null): void {
        const key = keyOf(table, rowid);

        this.backupForRollback(key);

        const existing = this.rows.get(key);

        if (existing?.kind === "insert") {
            this.rows.delete(key);
            return;
        }

        if (!existing) {
            if (!this.canTrackMore()) {
                return;
            }

            this.track(table, rowid, { kind: "delete", before, after: null });
            return;
        }

        existing.kind = "delete";
        existing.after = null;
        existing.lastChangedAt = Date.now();
    }

    /**
     * Filtre une liste de lignes pour ne garder que celles déjà suivies.
     *
     * Permet de rester juste sur une opération en lot trop volumineuse pour être
     * détaillée : les lignes déjà présentes au journal doivent être remises à
     * jour, les autres restent couvertes par l'entrée récapitulative.
     *
     * @param table - Table concernée.
     * @param rowids - Lignes de l'opération.
     * @returns Le sous-ensemble déjà suivi.
     */
    public trackedRowIds(table: string, rowids: number[]): number[] {
        return rowids.filter(rowid => this.rows.has(keyOf(table, rowid)));
    }

    /**
     * Marque comme supprimées les lignes déjà suivies d'une suppression en lot
     * non détaillée. Les lignes inconnues du journal sont ignorées : sans image
     * d'origine, elles n'apporteraient qu'une entrée vide.
     *
     * @param table - Table concernée.
     * @param rowids - Lignes supprimées.
     */
    public markTrackedAsDeleted(table: string, rowids: number[]): void {
        for (const rowid of rowids) {
            const key = keyOf(table, rowid);
            const existing = this.rows.get(key);

            if (!existing) {
                continue;
            }

            this.backupForRollback(key);

            if (existing.kind === "insert") {
                this.rows.delete(key);
                continue;
            }

            existing.kind = "delete";
            existing.after = null;
            existing.lastChangedAt = Date.now();
        }
    }

    /**
     * Marque supprimées toutes les lignes suivies d'une table (table vidée) :
     * celles insérées pendant la session disparaissent du journal, les autres
     * deviennent des suppressions de leur image d'origine.
     * @param table - Table vidée.
     */
    public markTableAsDeleted(table: string): void {
        const rowids: number[] = [];

        for (const row of this.rows.values()) {
            if (row.table === table) {
                rowids.push(row.rowid);
            }
        }

        this.markTrackedAsDeleted(table, rowids);
    }

    /**
     * Enregistre une opération dont l'effet ligne à ligne n'est pas capturé.
     * @param change - Description de l'opération.
     */
    public recordOpaque(change: {
        category: SessionOpaqueCategory;
        label: string;
        detail: string;
        table?: string | null;
        rowsAffected?: number | null;
    }): void {
        if (!this.isActive) {
            return;
        }

        this.opaque.unshift({
            id: this.nextOpaqueId++,
            at: Date.now(),
            category: change.category,
            label: change.label,
            detail: change.detail,
            table: change.table ?? null,
            rowsAffected: change.rowsAffected ?? null,
        });

        if (this.opaque.length > MAX_OPAQUE_ENTRIES) {
            this.opaque.length = MAX_OPAQUE_ENTRIES;
            this.capped = true;
        }
    }

    /**
     * Retourne les compteurs du diff, sans en transporter le contenu.
     */
    public getSummary(): SessionDiffSummary {
        const tables = new Set<string>();

        for (const row of this.rows.values()) {
            tables.add(row.table);
        }

        return {
            tables: tables.size,
            rows: this.rows.size,
            opaque: this.opaque.length,
        };
    }

    /**
     * Construit l'instantané complet du diff, groupé par table.
     */
    public getSnapshot(): SessionDiffSnapshot {
        const byTable = new Map<string, SessionTableDiff>();

        for (const row of this.rows.values()) {
            let group = byTable.get(row.table);

            if (!group) {
                group = { table: row.table, rows: [], inserted: 0, updated: 0, deleted: 0 };
                byTable.set(row.table, group);
            }

            group.rows.push(this.toPublicRow(row));

            switch (row.kind) {
                case "insert":
                    group.inserted++;
                    break;
                case "delete":
                    group.deleted++;
                    break;
                case "update":
                    group.updated++;
                    break;
            }
        }

        const tables = [...byTable.values()];

        for (const table of tables) {
            table.rows.sort((a, b) => a.firstChangedAt - b.firstChangedAt || a.rowid - b.rowid);
        }

        tables.sort((a, b) => a.table.localeCompare(b.table));

        return {
            active: this.isActive,
            startedAt: this.startedAt,
            source: this.source,
            tables,
            opaque: [...this.opaque],
            summary: this.getSummary(),
            capped: this.capped,
        };
    }

    // --- Helpers privés ---

    /**
     * Conserve l'état d'une entrée avant sa première modification de la
     * transaction courante. Sans effet hors transaction.
     */
    private backupForRollback(key: string): void {
        if (!this.transactionBackup || this.transactionBackup.has(key)) {
            return;
        }

        const current = this.rows.get(key);

        this.transactionBackup.set(key, current ? { ...current } : null);
    }

    /**
     * Indique si une nouvelle ligne peut encore être suivie.
     */
    private canTrackMore(): boolean {
        if (!this.isActive) {
            return false;
        }

        if (this.rows.size < MAX_TRACKED_ROWS) {
            return true;
        }

        this.capped = true;
        return false;
    }

    /**
     * Insère une ligne dans le journal.
     */
    private track(
        table: string,
        rowid: number,
        state: Pick<TrackedRow, "kind" | "before" | "after">,
    ): void {
        const now = Date.now();

        this.rows.set(keyOf(table, rowid), {
            table,
            rowid,
            ...state,
            firstChangedAt: now,
            lastChangedAt: now,
        });
    }

    /**
     * Retire du journal une ligne revenue à son état d'origine (annulation,
     * ré-écriture de la même valeur) : son effet net est nul, elle n'a rien à
     * faire dans un diff.
     */
    private pruneIfUnchanged(table: string, rowid: number, row: TrackedRow): void {
        if (row.kind !== "update") {
            return;
        }

        if (changedColumnsOf(row.before, row.after).length === 0) {
            this.rows.delete(keyOf(table, rowid));
        }
    }

    /**
     * Projette une ligne suivie vers sa forme exposée au renderer.
     */
    private toPublicRow(row: TrackedRow): SessionRowDiff {
        return {
            rowid: row.rowid,
            kind: row.kind,
            before: row.before,
            after: row.after,
            changedColumns: row.kind === "update" ? changedColumnsOf(row.before, row.after) : [],
            firstChangedAt: row.firstChangedAt,
            lastChangedAt: row.lastChangedAt,
        };
    }
}

/** Ligne suivie en interne : identique à la forme publique, colonnes recalculées à la demande. */
interface TrackedRow {
    table: string;
    rowid: number;
    kind: SessionRowDiff["kind"];
    before: DbRecord | null;
    after: DbRecord | null;
    firstChangedAt: number;
    lastChangedAt: number;
}

/**
 * Clé d'indexation d'une ligne. Le séparateur NUL ne peut pas apparaître dans un
 * nom de table, ce qui écarte toute collision entre deux tables dont les noms
 * ne diffèrent que par le caractère de séparation.
 */
function keyOf(table: string, rowid: number): string {
    return `${table}\u0000${rowid}`;
}

/**
 * Retourne les colonnes dont la valeur diffère entre deux images d'une ligne.
 * @param before - Image d'origine.
 * @param after - Image courante.
 * @returns Les noms de colonnes modifiées, hors colonnes d'identité.
 */
export function changedColumnsOf(before: DbRecord | null, after: DbRecord | null): string[] {
    if (!before || !after) {
        return [];
    }

    const columns = new Set([...Object.keys(before), ...Object.keys(after)]);
    const changed: string[] = [];

    for (const column of columns) {
        if (IDENTITY_COLUMNS.has(column)) {
            continue;
        }

        if (!valuesEqual(before[column], after[column])) {
            changed.push(column);
        }
    }

    return changed;
}

/**
 * Compare deux valeurs de cellule.
 *
 * Les drivers renvoient des primitives, `null`, ou des `Buffer` pour les BLOB :
 * une comparaison `===` classerait deux BLOB identiques comme différents, et
 * `JSON.stringify` sérialiserait tout Buffer en un objet indistinct.
 */
function valuesEqual(a: unknown, b: unknown): boolean {
    if (a === b) {
        return true;
    }

    // `null` et `undefined` désignent tous deux l'absence de valeur côté base.
    if (a === null || a === undefined || b === null || b === undefined) {
        return (a === null || a === undefined) && (b === null || b === undefined);
    }

    const aBytes = asBytes(a);
    const bBytes = asBytes(b);

    if (aBytes && bBytes) {
        if (aBytes.byteLength !== bBytes.byteLength) {
            return false;
        }

        for (let i = 0; i < aBytes.byteLength; i++) {
            if (aBytes[i] !== bBytes[i]) {
                return false;
            }
        }

        return true;
    }

    if (aBytes || bBytes) {
        return false;
    }

    if (typeof a === "object" && typeof b === "object") {
        return JSON.stringify(a) === JSON.stringify(b);
    }

    return false;
}

/**
 * Retourne la vue octets d'une valeur binaire, ou `null` si la valeur n'en est pas une.
 */
function asBytes(value: unknown): Uint8Array | null {
    if (value instanceof Uint8Array) {
        return value;
    }

    if (value instanceof ArrayBuffer) {
        return new Uint8Array(value);
    }

    return null;
}
