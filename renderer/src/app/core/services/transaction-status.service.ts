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

import { computed, effect, inject, Injectable, signal, untracked } from "@angular/core";
import type { PendingTransactionInfo } from "src/app/core/models/shell.model";
import { DatabaseService } from "src/app/core/services/database.service";
import { MutationHistoryService } from "src/app/core/services/mutation-history.service";
import { SessionDiffService } from "src/app/core/services/session-diff.service";

/**
 * Suit ce qui a été modifié depuis l'ouverture de la transaction courante
 * (bandeau de transaction et pastille de la barre d'état).
 *
 * Aucun compteur « par transaction » n'existe côté main : le diff de session
 * couvre toute la connexion. On mémorise donc ses compteurs à l'ouverture de la
 * transaction et on affiche l'écart. Un ROLLBACK restaure le journal du main,
 * l'écart retombe alors naturellement à zéro. Les tables touchées sont relevées
 * dans l'historique d'annulation, vidé au changement de table : on les cumule ici.
 */
@Injectable({ providedIn: "root" })
export class TransactionStatusService {
    private readonly dbService = inject(DatabaseService);
    private readonly sessionDiff = inject(SessionDiffService);
    private readonly mutationHistory = inject(MutationHistoryService);

    /** Compteurs du diff de session à l'ouverture de la transaction. */
    private readonly baseline = signal<number>(0);

    /** Tables touchées depuis l'ouverture de la transaction. */
    private readonly touchedTables = signal<ReadonlySet<string>>(new Set());

    /** Une transaction est ouverte sur la base de la fenêtre. */
    public readonly open = computed<boolean>(() => this.dbService.inTransaction());

    /** Modifications en attente de validation. */
    public readonly pending = computed<PendingTransactionInfo>(() => {
        if (!this.open()) {
            return { count: 0, tables: [] };
        }

        const summary = this.sessionDiff.summary();
        const count = Math.max(0, summary.rows + summary.opaque - this.baseline());

        return { count, tables: [...this.touchedTables()] };
    });

    public constructor() {
        effect(() => {
            const open = this.dbService.inTransaction();

            untracked(() => {
                const summary = this.sessionDiff.summary();
                this.baseline.set(open ? summary.rows + summary.opaque : 0);
                this.touchedTables.set(new Set());
            });
        });

        effect(() => {
            const history = this.mutationHistory.history();

            if (!untracked(() => this.dbService.inTransaction()) || history.length === 0) {
                return;
            }

            untracked(() => {
                const current = this.touchedTables();
                const missing = history.filter(mutation => !current.has(mutation.table));

                if (missing.length > 0) {
                    this.touchedTables.set(new Set([...current, ...missing.map(mutation => mutation.table)]));
                }
            });
        });
    }
}
