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

import { Injectable, signal, computed } from "@angular/core";
import type { MutationRecord, MutationType } from "@shared/types";

/**
 * Gère l'historique des mutations (éditions, insertions, suppressions)
 * pour le mécanisme Annuler/Rétablir (Ctrl+Z / Ctrl+Y).
 *
 * Les mutations sont enregistrées localement — cela ne touche pas la base de données.
 * L'annulation déclenche une requête inverse au processus principal.
 */
@Injectable({ providedIn: "root" })
export class MutationHistoryService {
    private readonly undoStack = signal<MutationRecord[]>([]);
    private readonly redoStack = signal<MutationRecord[]>([]);
    private nextId = 1;

    /** Indique si une annulation est possible. */
    public readonly canUndo = computed(() => this.undoStack().length > 0);

    /** Indique si un rétablissement est possible. */
    public readonly canRedo = computed(() => this.redoStack().length > 0);

    /** Nombre de mutations dans la pile d'annulation. */
    public readonly undoCount = computed(() => this.undoStack().length);

    /** Retourne une lecture seule de la pile d'annulation (pour l'affichage du diff). */
    public readonly history = computed(() => [...this.undoStack()]);

    /**
     * Enregistre une mutation dans la pile d'annulation.
     * Efface le stack de rétablissement à chaque nouvelle mutation.
     */
    public push(mutation: Omit<MutationRecord, "id">): MutationRecord {
        const record: MutationRecord = { ...mutation, id: this.nextId++ };
        this.undoStack.update(stack => [...stack, record]);
        this.redoStack.set([]);
        return record;
    }

    /**
     * Dépile et retourne la dernière mutation pour l'annuler.
     * La place dans la pile de rétablissement.
     */
    public popForUndo(): MutationRecord | null {
        const stack = this.undoStack();
        if (stack.length === 0) {
            return null;
        }

        const last = stack[stack.length - 1];
        if (!last) {
            return null;
        }
        this.undoStack.set(stack.slice(0, -1));
        this.redoStack.update(redo => [...redo, last]);
        return last;
    }

    /**
     * Dépile et retourne la dernière mutation annulée pour la rétablir.
     * La replace dans la pile d'annulation.
     */
    public popForRedo(): MutationRecord | null {
        const stack = this.redoStack();
        if (stack.length === 0) {
            return null;
        }

        const last = stack[stack.length - 1];
        if (!last) {
            return null;
        }
        this.redoStack.set(stack.slice(0, -1));
        this.undoStack.update(undo => [...undo, last]);
        return last;
    }

    /**
     * Vide les deux piles (à appeler lors du commit ou rollback de transaction,
     * ou lors du changement de table).
     */
    public clear(): void {
        this.undoStack.set([]);
        this.redoStack.set([]);
    }

    /**
     * Retourne les mutations de la table courante (pour le diff de transaction).
     */
    public getHistoryForTable(tableName: string): MutationRecord[] {
        return this.undoStack().filter(m => m.table === tableName);
    }

    /**
     * Retourne un résumé humain d'une mutation pour l'affichage.
     */
    public describeMutation(mutation: MutationRecord): string {
        switch (mutation.type) {
            case "update":
                return `Update row ${mutation.rowid}: ${mutation.column} = ${JSON.stringify(mutation.newValue)}`;
            case "insert":
                return `Insert row ${mutation.rowid}`;
            case "delete":
                return `Delete row ${mutation.rowid}`;
            default:
                return `Unknown mutation on row ${mutation.rowid}`;
        }
    }

    /**
     * Construit l'opération inverse d'une mutation pour l'annuler.
     */
    public getInverseType(type: MutationType): MutationType {
        switch (type) {
            case "insert":
                return "delete";
            case "delete":
                return "insert";
            case "update":
                return "update";
        }
    }
}
