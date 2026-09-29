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

import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { DatabaseService } from "src/app/core/services/database.service";
import { I18nService } from "src/app/core/services/i18n.service";
import { ShellService } from "src/app/core/services/shell.service";
import { TransactionStatusService } from "src/app/core/services/transaction-status.service";
import { TranslatePipe } from "src/app/shared/pipes/translate.pipe";

/**
 * Bandeau affiché sous la barre d'onglets tant qu'une transaction est ouverte :
 * résumé des modifications en attente, accès au diff, validation ou annulation.
 */
@Component({
    selector: "app-transaction-banner",
    standalone: true,
    templateUrl: "./transaction-banner.component.html",
    styleUrl: "./transaction-banner.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [TranslatePipe],
})
export class TransactionBannerComponent {
    private readonly dbService = inject(DatabaseService);
    private readonly i18n = inject(I18nService);
    private readonly shell = inject(ShellService);
    protected readonly transaction = inject(TransactionStatusService);

    /** « 3 modification(s) non validée(s) sur clients, commandes ». */
    protected readonly pendingLabel = computed<string>(() => {
        const { count, tables } = this.transaction.pending();

        return tables.length > 0
            ? this.i18n.t("transaction.pendingOnTables", { count, tables: tables.join(", ") })
            : this.i18n.t("transaction.pending", { count });
    });

    protected viewDiff(): void {
        this.shell.openSessionDiff();
    }

    protected rollback(): void {
        void this.dbService.transactionAction("rollback");
    }

    protected commit(): void {
        void this.dbService.transactionAction("commit");
    }
}
