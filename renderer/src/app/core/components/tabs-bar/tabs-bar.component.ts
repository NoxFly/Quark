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

import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from "@angular/core";
import { Router } from "@angular/router";
import { DatabaseService } from "src/app/core/services/database.service";
import { I18nService } from "src/app/core/services/i18n.service";
import { StateService } from "src/app/core/services/state.service";
import { getSpecialTab, TabsService } from "src/app/core/services/tabs.service";
import type { SpecialTab, TableTab } from "src/app/core/services/tabs.service";
import { ContextMenuComponent } from "src/app/shared/components/context-menu/context-menu.component";
import { TooltipDirective } from "src/app/shared/ui/components/tooltip/tooltip.directive";

/** Glyphe d'un onglet de table. */
const TABLE_TAB_ICON = "▤";

/** Glyphe des onglets spéciaux, indexé par le dernier segment de leur route. */
const SPECIAL_TAB_ICONS: Readonly<Record<string, string>> = {
    "sql-editor": "SQL",
    "er-diagram": "ER",
    "session-diff": "Δ",
    "indexes": "IX",
    "index-viewer": "IX",
    "stored-procedure": "SP",
};

/**
 * Barre d'onglets pour les tables ouvertes dans le dashboard.
 * Affiche un onglet par table ouverte avec drag & drop pour réorganiser.
 */
@Component({
    selector: "app-tabs-bar",
    standalone: true,
    templateUrl: "./tabs-bar.component.html",
    styleUrl: "./tabs-bar.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ContextMenuComponent, TooltipDirective],
})
export class TabsBarComponent {
    private readonly router = inject(Router);
    protected readonly tabsService = inject(TabsService);
    protected readonly dbService = inject(DatabaseService);
    protected readonly state = inject(StateService);
    protected readonly i18n = inject(I18nService);

    protected readonly tabs = computed(() => this.tabsService.openTabs());
    protected readonly activeIndex = computed(() => this.tabsService.activeTabIndex());

    protected readonly contextMenu = viewChild.required(ContextMenuComponent);

    /** Index de l'onglet en cours de drag (-1 si aucun). */
    protected readonly dragIndex = signal<number>(-1);
    /** Index de l'onglet survolé pendant le drag. */
    protected readonly dragOverIndex = signal<number>(-1);

    /**
     * Bascule sur un onglet.
     */
    protected async switchTab(index: number, tab: TableTab): Promise<void> {
        const special = this.specialTab(tab);

        if (special) {
            this.tabsService.switchTab(index);
            this.dbService.selectedTable.set(null);
            this.router.navigate([special.route]);
            return;
        }

        await this.dbService.selectTable(tab.tableName);
    }

    /**
     * Retourne la définition de l'onglet spécial, ou `null` pour un onglet de table.
     */
    protected specialTab(tab: TableTab): SpecialTab | null {
        return getSpecialTab(tab.tableName);
    }

    /**
     * Glyphe monospace devant le libellé (▤ table, SQL, ER, Δ diff, IX index, SP procédure).
     * Déduit de la route de l'onglet spécial, pour qu'un onglet ajouté au registre
     * reçoive son glyphe sans toucher à ce composant.
     */
    protected tabIcon(tab: TableTab): string {
        const route = this.specialTab(tab)?.route;

        if (!route) {
            return TABLE_TAB_ICON;
        }

        const entry = Object.entries(SPECIAL_TAB_ICONS).find(([segment]) => route.endsWith(segment));
        return entry?.[1] ?? TABLE_TAB_ICON;
    }

    /**
     * Retourne le libellé affiché pour un onglet.
     */
    protected tabLabel(tab: TableTab): string {
        const special = this.specialTab(tab);

        return special ? this.i18n.t(special.labelKey, special.labelParams) : tab.tableName;
    }

    /**
     * Ferme un onglet.
     */
    protected async closeTab(event: MouseEvent, index: number): Promise<void> {
        event.stopPropagation();

        const nextTable = this.tabsService.closeTab(index);

        if (nextTable) {
            await this.dbService.activateTab(nextTable);
        }
        else {
            this.router.navigate(["/dashboard/no-table"]);
        }
    }

    /**
     * Ferme tous les onglets.
     */
    protected async closeAllTabs(): Promise<void> {
        this.tabsService.closeAll();
        this.dbService.selectedTable.set(null);
        this.dbService.tableData.set([]);
        this.dbService.totalCount.set(0);
        this.dbService.tableSchema.set(null);
        this.router.navigate(["/dashboard/no-table"]);
    }

    /**
     * Ferme tous les onglets sauf celui à l'index donné.
     */
    protected async closeOtherTabs(keepIndex: number): Promise<void> {
        const tab = this.tabs()[keepIndex];
        if (!tab) {
            return;
        }
        this.tabsService.closeAll();
        this.tabsService.openTab(tab.tableName);
        await this.dbService.activateTab(tab.tableName);
    }

    /**
     * Ouvre le menu contextuel sur un onglet.
     */
    protected onTabContextMenu(event: MouseEvent, index: number): void {
        const tab = this.tabs()[index];
        if (!tab) {
            return;
        }
        this.contextMenu().open(event, [
            {
                label: this.i18n.t("tabs.close"),
                action: () => void this.closeTab(new MouseEvent("click"), index),
            },
            {
                label: this.i18n.t("tabs.closeOthers"),
                disabled: this.tabs().length <= 1,
                action: () => void this.closeOtherTabs(index),
            },
            {
                label: this.i18n.t("tabs.closeAll"),
                action: () => void this.closeAllTabs(),
            },
        ]);
    }

    /**
     * Scroll horizontal sur la molette de la souris (sans Shift).
     */
    protected onWheel(event: WheelEvent): void {
        if (event.shiftKey) {
            return;
        }
        event.preventDefault();
        (event.currentTarget as HTMLElement).scrollLeft += event.deltaY;
    }

    // --- Drag & Drop ---

    protected onDragStart(event: DragEvent, index: number): void {
        this.dragIndex.set(index);
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", String(index));
        }
    }

    protected onDragOver(event: DragEvent, index: number): void {
        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "move";
        }
        this.dragOverIndex.set(index);
    }

    protected onDragLeave(): void {
        this.dragOverIndex.set(-1);
    }

    protected onDrop(event: DragEvent, toIndex: number): void {
        event.preventDefault();
        const fromIndex = this.dragIndex();
        if (fromIndex >= 0 && fromIndex !== toIndex) {
            this.tabsService.reorderTab(fromIndex, toIndex);
        }
        this.dragIndex.set(-1);
        this.dragOverIndex.set(-1);
    }

    protected onDragEnd(): void {
        this.dragIndex.set(-1);
        this.dragOverIndex.set(-1);
    }
}
