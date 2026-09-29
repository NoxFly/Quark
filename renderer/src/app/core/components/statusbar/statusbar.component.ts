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
import { Router } from "@angular/router";
import { TooltipDirective } from "src/app/shared/ui/components/tooltip/tooltip.directive";
import { DatabaseService } from "src/app/core/services/database.service";
import { I18nService } from "src/app/core/services/i18n.service";
import { ShellService } from "src/app/core/services/shell.service";
import { StateService } from "src/app/core/services/state.service";
import { getSpecialTab, SQL_EDITOR_TAB_ID, TabsService } from "src/app/core/services/tabs.service";
import { TransactionStatusService } from "src/app/core/services/transaction-status.service";
import { DRIVER_MONOGRAMS } from "src/app/shared/helpers/driver-presentation.helper";

@Component({
    selector: "app-statusbar",
    standalone: true,
    templateUrl: "./statusbar.component.html",
    styleUrl: "./statusbar.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [TooltipDirective],
    host: {
        "[class.visible]": "state.connected()",
    },
})
export class StatusbarComponent {
    protected readonly state = inject(StateService);
    protected readonly dbService = inject(DatabaseService);
    protected readonly i18n = inject(I18nService);
    protected readonly transaction = inject(TransactionStatusService);
    private readonly shell = inject(ShellService);
    private readonly router = inject(Router);
    private readonly tabsService = inject(TabsService);

    /** « 200 / 12 480 lignes » pour la table affichée. */
    protected readonly recordInfo = computed(() => {
        if (!this.dbService.selectedTable()) {
            return "";
        }

        return this.i18n.t(
            this.state.isNoSqlDatabase() ? "statusbar.documents" : "statusbar.rows",
            {
                loaded: this.i18n.formatNumber(this.dbService.tableData().length),
                total: this.i18n.formatNumber(this.dbService.totalCount()),
            },
        );
    });

    protected readonly tableSizeInfo = computed(() => {
        const size = this.dbService.tableSize();

        if (!size || !this.dbService.selectedTable()) {
            return "";
        }

        return this.formatSize(size);
    });

    /**
     * L'onglet actif affiche une table : la sélection de lignes n'a de sens que
     * là, elle n'est pas vidée quand on passe sur l'éditeur SQL, un diff ou des index.
     */
    protected readonly isTableTabActive = computed<boolean>(() => {
        const tableName = this.tabsService.activeTab()?.tableName ?? null;
        return tableName !== null && getSpecialTab(tableName) === null;
    });

    protected readonly selectionInfo = computed(() => {
        if (!this.isTableTabActive()) {
            return "";
        }

        const count = this.dbService.selectedCount();
        return count === 0 ? "" : this.i18n.t("statusbar.selected", { count });
    });

    protected readonly readOnly = computed(() => this.dbService.readOnly());

    /** Monogramme du driver actif, dans la pastille de droite. */
    protected readonly driverMonogram = computed<string>(() => {
        const type = this.state.driverType();
        return type ? DRIVER_MONOGRAMS[type] : "";
    });

    /**
     * Indique si l'utilisateur est actuellement dans l'éditeur SQL.
     */
    protected readonly isInSqlEditor = computed(() => this.tabsService.activeTab()?.tableName === SQL_EDITOR_TAB_ID);

    /**
     * Bascule entre l'éditeur SQL (onglet dédié) et la vue précédente.
     */
    protected toggleSqlEditor(): void {
        if (!this.isInSqlEditor()) {
            this.shell.openSqlEditor();
            return;
        }

        const sqlIdx = this.tabsService.findTab(SQL_EDITOR_TAB_ID);
        const nextTable = sqlIdx >= 0 ? this.tabsService.closeTab(sqlIdx) : null;

        if (nextTable) {
            void this.dbService.activateTab(nextTable);
        }
        else {
            void this.router.navigate(["/dashboard/no-table"]);
        }
    }

    protected toggleReadOnly(): void {
        this.dbService.toggleReadOnly();
    }

    protected openSessionDiff(): void {
        this.shell.openSessionDiff();
    }

    /**
     * Taille lisible (« 1,4 Mo »), dans la langue courante.
     */
    private formatSize(bytes: number): string {
        if (bytes < 1024) {
            return this.i18n.t("statusbar.sizeBytes", { size: this.i18n.formatNumber(bytes) });
        }

        if (bytes < 1024 * 1024) {
            return this.i18n.t("statusbar.sizeKilobytes", {
                size: this.i18n.formatNumber(bytes / 1024, { maximumFractionDigits: 1 }),
            });
        }

        return this.i18n.t("statusbar.sizeMegabytes", {
            size: this.i18n.formatNumber(bytes / (1024 * 1024), { maximumFractionDigits: 2 }),
        });
    }
}
