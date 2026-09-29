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

import { Logger } from "@noxfly/noxus";
import type {
    SessionRevertFailure,
    SessionRevertFailureReason,
    SessionRevertResult,
    SessionRowDiff,
    SessionRowRef,
} from "@shared/session-diff";
import type { DbRecord } from "@shared/types";
import type { DatabaseDriver } from "src/core/drivers/driver.interface";
import { type SessionDiff, valuesEqual } from "src/core/services/session-diff";

/** Colonne d'identité ajoutée par les drivers à chaque ligne lue : ce n'est pas une donnée. */
const IDENTITY_COLUMN = "rowid";

/** Drivers du dialecte SQLite, dont le rowid peut être fixé à l'insertion. */
const SQLITE_DIALECTS = new Set(["sqlite", "libsql"]);

/**
 * Ordre d'exécution d'une annulation groupée, par nature de changement.
 *
 * 1. réinsérer les lignes supprimées (parents d'abord) : une modification ou
 *    une ligne enfant à restaurer peut y faire référence ;
 * 2. restaurer les modifications (parents d'abord) : un enfant réaffecté à une
 *    ligne insérée pendant la session doit la lâcher avant qu'on la supprime ;
 * 3. supprimer les lignes insérées (enfants d'abord).
 */
const PHASES: readonly SessionRowDiff["kind"][] = ["delete", "update", "insert"];

/** Échec d'annulation identifié, par opposition à une erreur du driver. */
class RevertError extends Error {
    public constructor(public readonly reason: SessionRevertFailureReason) {
        super(reason);
    }
}

/**
 * Annule des lignes du diff de session : remet la base dans l'état d'origine de
 * chaque ligne à partir des images avant/après conservées par `SessionDiff`.
 *
 * Travaille directement sur le driver et met le journal à jour lui-même :
 * passer par les méthodes journalisées de `Window` enregistrerait l'annulation
 * comme une nouvelle modification (une réinsertion deviendrait un `INSERT`).
 * C'est la relecture de chaque ligne qui la fait disparaître du diff
 * (`pruneIfUnchanged`) : une restauration incomplète y reste visible.
 */
export class SessionReverter {
    /**
     * @param driver - Driver de la connexion suivie.
     * @param diff - Journal de la session.
     */
    public constructor(
        private readonly driver: DatabaseDriver,
        private readonly diff: SessionDiff,
    ) {}

    /**
     * Annule une ligne du journal.
     * @param ref - Ligne à annuler.
     */
    public async revertRow(ref: SessionRowRef): Promise<SessionRevertResult> {
        const row = this.diff.getRow(ref.table, ref.rowid);

        if (!row) {
            return this.result(0, [failureOf(ref, null, "not-tracked", "")], false, false);
        }

        return await this.run([{ table: ref.table, row }]);
    }

    /**
     * Annule un ensemble de lignes du journal : lignes désignées et/ou toutes
     * celles des tables désignées ; tout le journal si aucune liste n'est fournie.
     * @param rows - Lignes à annuler.
     * @param tables - Tables dont toutes les lignes sont à annuler.
     */
    public async revertAll(rows?: readonly SessionRowRef[], tables?: readonly string[]): Promise<SessionRevertResult> {
        const failures: SessionRevertFailure[] = [];
        const selected = new Map<string, { table: string; row: SessionRowDiff }>();

        // Seule l'absence des deux listes désigne tout le journal : une liste
        // vide (filtre sans résultat) ne doit rien annuler.
        if (rows === undefined && tables === undefined) {
            for (const entry of this.diff.listRows()) {
                selected.set(refKey(entry.table, entry.row.rowid), entry);
            }
        }
        else {
            if (tables?.length) {
                for (const entry of this.diff.listRows(tables)) {
                    selected.set(refKey(entry.table, entry.row.rowid), entry);
                }
            }

            for (const ref of rows ?? []) {
                const row = this.diff.getRow(ref.table, ref.rowid);

                if (!row) {
                    failures.push(failureOf(ref, null, "not-tracked", ""));
                    continue;
                }

                selected.set(refKey(ref.table, ref.rowid), { table: ref.table, row });
            }
        }

        const result = await this.run([...selected.values()]);

        return { ...result, failures: [...failures, ...result.failures] };
    }

    // --- Exécution ---

    /**
     * Annule les lignes données dans l'ordre qui respecte au mieux les clés
     * étrangères, dans une transaction si le driver le permet et qu'aucune
     * n'est ouverte — tout ou rien.
     *
     * Dans une transaction déjà ouverte par l'utilisateur, ou sans transaction,
     * chaque ligne est tentée, et celles en échec le sont une seconde fois à la
     * fin : l'annulation d'une autre ligne a pu lever l'obstacle.
     */
    private async run(entries: { table: string; row: SessionRowDiff }[]): Promise<SessionRevertResult> {
        const failures: SessionRevertFailure[] = [];
        const revertible: { table: string; row: SessionRowDiff }[] = [];

        // Les entrées non annulables sont écartées d'emblée : elles ne doivent
        // pas faire échouer tout un lot transactionnel.
        for (const entry of entries) {
            if (entry.row.revertible) {
                revertible.push(entry);
            }
            else {
                failures.push(failureOf({ table: entry.table, rowid: entry.row.rowid }, entry.row.kind, "not-revertible", ""));
            }
        }

        if (revertible.length === 0) {
            return this.result(0, failures, false, false);
        }

        const ordered = await this.order(revertible);
        const transactional = this.driver.capabilities.transactions && !this.driver.isInTransaction;

        if (transactional) {
            return await this.runInTransaction(ordered, failures);
        }

        let reverted = 0;
        let pending: { table: string; row: SessionRowDiff }[] = [];

        for (const entry of ordered) {
            if (await this.tryRevert(entry.table, entry.row) === null) {
                reverted++;
            }
            else {
                pending.push(entry);
            }
        }

        // Seconde passe : l'ordre par clés étrangères ne couvre ni les tables
        // auto-référencées ni les cycles.
        const retry = pending;
        pending = [];

        for (const entry of retry) {
            const row = this.diff.getRow(entry.table, entry.row.rowid) ?? entry.row;
            const failure = await this.tryRevert(entry.table, row);

            if (failure === null) {
                reverted++;
            }
            else {
                failures.push(failure);
            }
        }

        return this.result(reverted, failures, false, false);
    }

    /**
     * Annule les lignes dans une transaction ouverte pour l'occasion : au
     * premier échec, la base et le journal reviennent à leur état d'avant.
     */
    private async runInTransaction(
        ordered: { table: string; row: SessionRowDiff }[],
        failures: SessionRevertFailure[],
    ): Promise<SessionRevertResult> {
        await this.driver.beginTransaction();
        this.diff.beginTransaction();

        await this.deferForeignKeys();

        for (const entry of ordered) {
            const failure = await this.tryRevert(entry.table, entry.row);

            if (failure !== null) {
                await this.rollback();
                return this.result(0, [...failures, failure], true, true);
            }
        }

        try {
            await this.driver.commit();
            this.diff.commitTransaction();
        }
        catch (error) {
            // Contrainte différée violée au `COMMIT` : rien n'est appliqué.
            await this.rollback();

            const first = ordered[0];
            const ref = first ? { table: first.table, rowid: first.row.rowid } : { table: "", rowid: 0 };

            return this.result(0, [...failures, failureOf(ref, first?.row.kind ?? null, "error", errorMessage(error))], true, true);
        }

        return this.result(ordered.length, failures, true, false);
    }

    /**
     * Annule la transaction de l'annulation, et le journal avec elle.
     */
    private async rollback(): Promise<void> {
        try {
            if (this.driver.isInTransaction) {
                await this.driver.rollback();
            }
        }
        catch (error) {
            Logger.warn(`Session revert: rollback failed: ${errorMessage(error)}`);
        }

        this.diff.rollbackTransaction();
    }

    /**
     * Sous SQLite, reporte la vérification des clés étrangères au `COMMIT` :
     * l'ordre d'exécution ne suffit pas pour une table auto-référencée, et un
     * état intermédiaire incohérent n'a pas d'importance si l'état final est
     * valide. Les autres dialectes n'ont pas d'équivalent sans DDL.
     */
    private async deferForeignKeys(): Promise<void> {
        if (!SQLITE_DIALECTS.has(this.driver.driverType)) {
            return;
        }

        try {
            await this.driver.execSql("PRAGMA defer_foreign_keys = ON");
        }
        catch (error) {
            Logger.warn(`Session revert: unable to defer foreign keys: ${errorMessage(error)}`);
        }
    }

    /**
     * Annule une ligne sans lever d'erreur.
     * @returns `null` si la ligne est annulée, l'échec sinon.
     */
    private async tryRevert(table: string, row: SessionRowDiff): Promise<SessionRevertFailure | null> {
        try {
            await this.revertEntry(table, row);
            return null;
        }
        catch (error) {
            const ref = { table, rowid: row.rowid };

            if (error instanceof RevertError) {
                return failureOf(ref, row.kind, error.reason, "");
            }

            return failureOf(ref, row.kind, "error", errorMessage(error));
        }
    }

    /**
     * Remet une ligne dans son état d'origine et aligne le journal.
     *
     * L'état courant est relu et comparé à la dernière image capturée : une
     * ligne modifiée hors du journal (SQL brut) serait sinon écrasée sans que
     * l'utilisateur ait vu ce qu'il perd.
     */
    private async revertEntry(table: string, row: SessionRowDiff): Promise<void> {
        const current = await this.driver.getRow(table, row.rowid);

        switch (row.kind) {
            case "update":
                await this.revertUpdate(table, row, current);
                break;
            case "insert":
                await this.revertInsert(table, row, current);
                break;
            case "delete":
                await this.revertDelete(table, row, current);
                break;
        }
    }

    /**
     * Restaure les valeurs d'origine des seules colonnes modifiées.
     */
    private async revertUpdate(table: string, row: SessionRowDiff, current: DbRecord | null): Promise<void> {
        const { before, after } = row;

        if (!before || !after) {
            throw new RevertError("not-revertible");
        }

        if (!current) {
            throw new RevertError("row-missing");
        }

        if (row.changedColumns.some(column => !valuesEqual(current[column], after[column]))) {
            throw new RevertError("row-changed");
        }

        for (const column of row.changedColumns) {
            await this.driver.updateCell(table, row.rowid, column, before[column]);
        }

        const restored = await this.driver.getRow(table, row.rowid);

        this.diff.recordUpdate(table, row.rowid, null, restored);
    }

    /**
     * Supprime une ligne insérée pendant la session.
     */
    private async revertInsert(table: string, row: SessionRowDiff, current: DbRecord | null): Promise<void> {
        if (!current) {
            throw new RevertError("row-missing");
        }

        if (row.after && !sameRecord(current, row.after)) {
            throw new RevertError("row-changed");
        }

        await this.driver.deleteRows(table, [row.rowid]);

        this.diff.recordDelete(table, row.rowid, current);
    }

    /**
     * Réinsère une ligne supprimée pendant la session, sous son identifiant d'origine.
     */
    private async revertDelete(table: string, row: SessionRowDiff, current: DbRecord | null): Promise<void> {
        if (!row.before) {
            throw new RevertError("not-revertible");
        }

        if (current) {
            throw new RevertError("row-exists");
        }

        const values: Record<string, unknown> = { ...row.before };

        delete values[IDENTITY_COLUMN];

        // Sous SQLite, une table sans `INTEGER PRIMARY KEY` n'expose son rowid
        // que par la pseudo-colonne : le fixer garde la ligne adressable par son
        // identifiant d'origine (et les références qui s'y rapportent valides).
        // Les autres drivers adressent la ligne par sa clé primaire, déjà dans l'image.
        if (SQLITE_DIALECTS.has(this.driver.driverType) && !("_rowid_" in values)) {
            values["_rowid_"] = row.rowid;
        }

        await this.driver.insertRow(table, values);

        const restored = await this.driver.getRow(table, row.rowid);

        this.diff.recordReinsert(table, row.rowid, restored);
    }

    /**
     * Trie les lignes selon `PHASES`, puis selon la profondeur de leur table
     * dans le graphe des clés étrangères.
     */
    private async order(entries: { table: string; row: SessionRowDiff }[]): Promise<{ table: string; row: SessionRowDiff }[]> {
        const depths = await this.tableDepths(new Set(entries.map(entry => entry.table)));
        const depthOf = (table: string): number => depths.get(table) ?? 0;

        return [...entries].sort((a, b) => {
            const phase = PHASES.indexOf(a.row.kind) - PHASES.indexOf(b.row.kind);

            if (phase !== 0) {
                return phase;
            }

            // Enfants d'abord pour supprimer, parents d'abord sinon.
            const depth = a.row.kind === "insert"
                ? depthOf(b.table) - depthOf(a.table)
                : depthOf(a.table) - depthOf(b.table);

            return depth || a.row.firstChangedAt - b.row.firstChangedAt;
        });
    }

    /**
     * Profondeur de chaque table dans le graphe des clés étrangères : 0 pour une
     * table qui ne référence rien, 1 + la profondeur de son parent le plus
     * profond sinon. Vide si le schéma est inaccessible ou sans intérêt.
     */
    private async tableDepths(tables: Set<string>): Promise<Map<string, number>> {
        const depths = new Map<string, number>();

        if (tables.size < 2 || !this.driver.capabilities.foreignKeys) {
            return depths;
        }

        let parents: Map<string, string[]>;

        try {
            const schema = await this.driver.getSchema();

            parents = new Map(schema.tables.map(table => [
                table.name,
                table.fields.flatMap(field => (field.fk && field.fk.table !== table.name ? [field.fk.table] : [])),
            ]));
        }
        catch (error) {
            Logger.warn(`Session revert: unable to read foreign keys: ${errorMessage(error)}`);
            return depths;
        }

        const visiting = new Set<string>();

        const depthOf = (table: string): number => {
            const known = depths.get(table);

            if (known !== undefined) {
                return known;
            }

            // Cycle : la profondeur n'a plus de sens, la seconde passe (ou le
            // report des contraintes) prend le relais.
            if (visiting.has(table)) {
                return 0;
            }

            visiting.add(table);

            const depth = Math.max(-1, ...(parents.get(table) ?? []).map(depthOf)) + 1;

            visiting.delete(table);
            depths.set(table, depth);

            return depth;
        };

        for (const table of tables) {
            depthOf(table);
        }

        return depths;
    }

    /**
     * Assemble le résultat renvoyé au renderer.
     */
    private result(
        reverted: number,
        failures: SessionRevertFailure[],
        transactional: boolean,
        rolledBack: boolean,
    ): SessionRevertResult {
        return { reverted, failures, transactional, rolledBack, summary: this.diff.getSummary() };
    }
}

/**
 * Construit un échec d'annulation.
 */
function failureOf(
    ref: SessionRowRef,
    kind: SessionRowDiff["kind"] | null,
    reason: SessionRevertFailureReason,
    message: string,
): SessionRevertFailure {
    return { table: ref.table, rowid: ref.rowid, kind, reason, message };
}

/**
 * Compare deux images d'une ligne, colonne d'identité exclue.
 */
function sameRecord(a: DbRecord, b: DbRecord): boolean {
    const columns = new Set([...Object.keys(a), ...Object.keys(b)]);

    for (const column of columns) {
        if (column !== IDENTITY_COLUMN && !valuesEqual(a[column], b[column])) {
            return false;
        }
    }

    return true;
}

/**
 * Clé d'unicité d'une ligne dans une sélection.
 */
function refKey(table: string, rowid: number): string {
    return `${table}\u0000${rowid}`;
}

/**
 * Message lisible d'une erreur quelconque.
 */
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
