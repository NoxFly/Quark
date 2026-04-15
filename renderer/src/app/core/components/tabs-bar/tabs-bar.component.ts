/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from "@angular/core";
import { Router } from "@angular/router";
import { DatabaseService } from "src/app/core/services/database.service";
import { I18nService } from "src/app/core/services/i18n.service";
import { StateService } from "src/app/core/services/state.service";
import { TabsService } from "src/app/core/services/tabs.service";
import { SQL_EDITOR_TAB_ID } from "src/app/core/services/tabs.service";
import type { TableTab } from "src/app/core/services/tabs.service";
import { ContextMenuComponent } from "src/app/shared/components/context-menu/context-menu.component";
import { TooltipDirective } from "src/app/shared/ui/components/tooltip/tooltip.directive";

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
        if (tab.tableName === SQL_EDITOR_TAB_ID) {
            this.tabsService.switchTab(index);
            this.dbService.selectedTable.set(null);
            this.router.navigate(["/dashboard/sql-editor"]);
            return;
        }
        await this.dbService.selectTable(tab.tableName);
    }

    /**
     * Retourne true si l'onglet est l'éditeur SQL.
     */
    protected isSqlEditorTab(tab: TableTab): boolean {
        return tab.tableName === SQL_EDITOR_TAB_ID;
    }

    /**
     * Ferme un onglet.
     */
    protected async closeTab(event: MouseEvent, index: number): Promise<void> {
        event.stopPropagation();

        const nextTable = this.tabsService.closeTab(index);

        if (nextTable) {
            await this.dbService.selectTable(nextTable);
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
        await this.dbService.selectTable(tab.tableName);
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
