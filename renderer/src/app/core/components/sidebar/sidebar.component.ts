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
import { StoredProceduresService } from "src/app/core/services/stored-procedures.service";
import { ButtonComponent } from "@ui/button/button.component";
import { ContextMenuComponent } from "src/app/shared/components/context-menu/context-menu.component";
import { TooltipDirective } from "src/app/shared/ui/components/tooltip/tooltip.directive";

@Component({
    selector: "app-sidebar",
    standalone: true,
    templateUrl: "./sidebar.component.html",
    styleUrl: "./sidebar.component.scss",
    imports: [ButtonComponent, ContextMenuComponent, TooltipDirective],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        "[style.width.px]": "width()",
        "[class.connected]": "state.connected()",
    },
})
export class SidebarComponent {
    protected readonly state = inject(StateService);
    protected readonly dbService = inject(DatabaseService);
    protected readonly i18n = inject(I18nService);
    protected readonly storedProcService = inject(StoredProceduresService);
    private readonly router = inject(Router);

    protected readonly width = signal<number>(220);
    protected readonly isResizing = signal<boolean>(false);

    protected readonly contextMenu = viewChild.required(ContextMenuComponent);

    /** Ensemble des tables actuellement dépliées dans la sidebar. */
    protected readonly expandedTables = signal<Set<string>>(new Set());

    /** Indique si la section "Tables" est repliée. */
    protected readonly tablesCollapsed = signal<boolean>(false);

    /** Indique si la section "Stored Procedures" est repliée. */
    protected readonly procsCollapsed = signal<boolean>(false);

    protected readonly tables = computed(() => {
        const db = this.state.database();
        return db?.tables ?? [];
    });

    protected readonly selectedTable = computed(() => this.dbService.selectedTable());
    protected readonly isNoSql = computed(() => this.state.isNoSqlDatabase());

    /** Indique si le driver supporte les procédures stockées. */
    protected readonly hasStoredProcedures = computed(() => this.state.capabilities()?.storedProcedures === true);

    /**
     * Sélectionne une table.
     */
    protected selectTable(tableName: string): void {
        this.dbService.selectTable(tableName);
    }

    /**
     * Déplie ou replie les détails d'une table.
     */
    protected toggleExpand(event: MouseEvent, tableName: string): void {
        event.stopPropagation();
        this.expandedTables.update(set => {
            const next = new Set(set);
            if (next.has(tableName)) {
                next.delete(tableName);
            }
            else {
                next.add(tableName);
            }
            return next;
        });
    }

    /**
     * Retourne true si la table est dépliée.
     */
    protected isExpanded(tableName: string): boolean {
        return this.expandedTables().has(tableName);
    }

    /**
     * Ouvre le menu contextuel pour une table.
     */
    protected onTableContextMenu(event: MouseEvent, tableName: string): void {
        const capabilities = this.state.capabilities();
        const isReadOnly = this.dbService.readOnly();
        const items: { label: string; icon?: string; action: () => void; separator?: boolean; danger?: boolean }[] = [];

        if (!isReadOnly && (!capabilities || capabilities.schemaEditing)) {
            items.push({
                label: this.i18n.t("sidebar.table.schemaEditor"),
                icon: "\uE70F",
                action: () => {
                    this.dbService.selectTable(tableName);
                    document.dispatchEvent(new CustomEvent("open-schema-editor"));
                },
            });
        }

        if (!capabilities || capabilities.indexes) {
            items.push({
                label: this.i18n.t("sidebar.table.indexViewer"),
                icon: "\uE773",
                action: () => {
                    this.dbService.selectTable(tableName);
                    document.dispatchEvent(new CustomEvent("open-index-viewer"));
                },
            });
        }

        if (!isReadOnly) {
            if (items.length > 0) {
                items.push({ label: "", action: () => {}, separator: true });
            }

            items.push({
                label: this.i18n.t(this.isNoSql() ? "sidebar.table.deleteTable.nosql" : "sidebar.table.deleteTable"),
                icon: "\uE74D",
                danger: true,
                action: () => void this.dbService.deleteTable(tableName),
            });
        }

        this.contextMenu().open(event, items);
    }

    /**
     * Démarre le redimensionnement de la sidebar.
     */
    protected startResize(event: MouseEvent): void {
        event.preventDefault();
        this.isResizing.set(true);

        const startX = event.clientX;
        const startWidth = this.width();

        const onMouseMove = (e: MouseEvent): void => {
            const delta = e.clientX - startX;
            const newWidth = Math.max(220, Math.min(500, startWidth + delta));
            this.width.set(newWidth);
        };

        const onMouseUp = (): void => {
            this.isResizing.set(false);
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    }

    /**
     * Rafraîchit la base de données.
     */
    protected refreshDatabase(): void {
        this.dbService.refreshDatabase();
        if (this.hasStoredProcedures()) {
            void this.storedProcService.loadProcedures();
        }
    }

    /**
     * Ferme le fichier en cours.
     */
    protected closeFile(): void {
        this.dbService.closeFile();
    }

    /**
     * Dispatche l'événement d'ouverture du modal de création de table.
     */
    protected dispatchCreateTable(): void {
        document.dispatchEvent(new CustomEvent("open-create-table"));
    }

    /**
     * Gère le clic sur le bouton "+" du section-header Tables.
     * Empêche la propagation pour ne pas toggler la section.
     */
    protected onCreateTable(event: MouseEvent): void {
        event.stopPropagation();
        this.dispatchCreateTable();
    }

    /**
     * Gère le clic sur le bouton "+" du section-header Procédures stockées.
     * Empêche la propagation pour ne pas toggler la section.
     */
    protected onCreateProcedure(event: MouseEvent): void {
        event.stopPropagation();
        this.dispatchCreateProcedure();
    }

    /**
     * Dispatche l'événement d'ouverture de la création d'une procédure stockée.
     */
    protected dispatchCreateProcedure(): void {
        this.router.navigate(["/dashboard/stored-procedure"]).then(() => {
            setTimeout(() => {
                document.dispatchEvent(new CustomEvent("create-stored-procedure"));
            }, 50);
        });
    }

    /**
     * Menu contextuel pour le section-header Tables.
     */
    protected onTablesSectionContextMenu(event: MouseEvent): void {
        event.preventDefault();
        if (this.dbService.readOnly()) {
            return;
        }

        const items: { label: string; icon?: string; action: () => void }[] = [
            {
                label: this.i18n.t(this.isNoSql() ? "sidebar.createCollection" : "sidebar.createTable"),
                icon: "\uE710",
                action: () => this.dispatchCreateTable(),
            },
        ];

        this.contextMenu().open(event, items);
    }

    /**
     * Menu contextuel pour le section-header Procédures stockées.
     */
    protected onProcsSectionContextMenu(event: MouseEvent): void {
        event.preventDefault();
        if (this.dbService.readOnly()) {
            return;
        }

        const items: { label: string; icon?: string; action: () => void }[] = [
            {
                label: this.i18n.t("sidebar.storedProcs.create"),
                icon: "\uE710",
                action: () => this.dispatchCreateProcedure(),
            },
        ];

        this.contextMenu().open(event, items);
    }

    /**
     * Bascule la visibilité de la section tables.
     */
    protected toggleTablesSection(): void {
        this.tablesCollapsed.update(v => !v);
    }

    /**
     * Bascule la visibilité de la section procédures stockées.
     */
    protected toggleProcsSection(): void {
        this.procsCollapsed.update(v => !v);
    }

    /**
     * Sélectionne une procédure stockée et navigue vers la vue dédiée.
     */
    protected selectProcedure(name: string, schema: string): void {
        this.router.navigate(["/dashboard/stored-procedure"]).then(() => {
            // Attendre que la page soit montée avant de dispatcher l'événement
            setTimeout(() => {
                document.dispatchEvent(new CustomEvent("open-stored-procedure", { detail: { name, schema } }));
            }, 50);
        });
    }

    /**
     * Menu contextuel pour une procédure stockée.
     */
    protected onProcContextMenu(event: MouseEvent, name: string, schema: string): void {
        event.preventDefault();
        const isReadOnly = this.dbService.readOnly();
        const items: { label: string; icon?: string; action: () => void; separator?: boolean; danger?: boolean }[] = [];

        items.push({
            label: this.i18n.t("sidebar.storedProcs.open"),
            icon: "\uE8A7",
            action: () => this.selectProcedure(name, schema),
        });

        if (!isReadOnly) {
            items.push({ label: "", action: () => {}, separator: true });
            items.push({
                label: this.i18n.t("sidebar.storedProcs.delete"),
                icon: "\uE74D",
                danger: true,
                action: () => void this.storedProcService.dropProcedure(name, schema),
            });
        }

        this.contextMenu().open(event, items);
    }
}
