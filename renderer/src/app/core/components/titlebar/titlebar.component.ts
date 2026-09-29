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

import { ChangeDetectionStrategy, Component, computed, inject, signal } from "@angular/core";
import type { RecentDatabaseEntry } from "@shared/ipc-renderer";
import type { Menu, MenuItem } from "src/app/core/models/shell.model";
import { DatabaseService } from "src/app/core/services/database.service";
import { I18nService, type SupportedLocale } from "src/app/core/services/i18n.service";
import { NoxusService } from "src/app/core/services/noxus.service";
import { ShellService } from "src/app/core/services/shell.service";
import { StateService } from "src/app/core/services/state.service";
import { ThemeService } from "src/app/core/services/theme.service";
import { UpdateService } from "src/app/core/services/update.service";
import { formatShortcut } from "src/app/shared/helpers/shortcut.helper";
import { TranslatePipe } from "src/app/shared/pipes/translate.pipe";
import { IconComponent } from "src/app/shared/ui/components/icon/icon.component";

/** Ordre des langues dans le sous-menu, celui de la maquette. */
const MENU_LOCALES: readonly SupportedLocale[] = ["fr", "en"];

/** Élément de séparation, partagé par tous les menus. */
const SEPARATOR: MenuItem = { label: "", separator: true };

@Component({
    selector: "app-titlebar",
    standalone: true,
    templateUrl: "./titlebar.component.html",
    styleUrl: "./titlebar.component.scss",
    imports: [TranslatePipe, IconComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        "(document:click)": "closeMenus()",
        "(window:keydown.escape)": "closeMenus()",
    },
})
export class TitlebarComponent {
    private readonly noxus = inject(NoxusService);
    private readonly dbService = inject(DatabaseService);
    private readonly i18n = inject(I18nService);
    private readonly updateService = inject(UpdateService);
    private readonly themeService = inject(ThemeService);
    protected readonly shell = inject(ShellService);
    protected readonly state = inject(StateService);

    protected readonly openMenuId = signal<string | null>(null);

    /** Bases récentes, rechargées à chaque ouverture du menu Fichier. */
    private readonly recents = signal<RecentDatabaseEntry[]>([]);

    /** « <base> — Quark » une fois connecté, « Quark » sinon. */
    protected readonly windowTitle = computed<string>(() => {
        const appName = this.state.appName() || "Quark";
        const databaseName = this.state.fileName() || this.state.database()?.name || "";

        return this.state.connected() && databaseName
            ? `${databaseName} — ${appName}`
            : appName;
    });

    protected readonly menus = computed<Menu[]>(() => [
        { id: "file", label: this.i18n.t("menu.file"), items: this.fileItems() },
        { id: "edit", label: this.i18n.t("menu.edit"), items: this.editItems() },
        { id: "view", label: this.i18n.t("menu.view"), items: this.viewItems() },
        { id: "database", label: this.i18n.t("menu.database"), items: this.databaseItems() },
        { id: "help", label: this.i18n.t("menu.help"), items: this.helpItems() },
    ]);

    /**
     * Ouvre ou ferme un menu. Le menu Fichier recharge les bases récentes, qui
     * changent à chaque ouverture de base, y compris depuis une autre fenêtre.
     */
    protected toggleMenu(event: MouseEvent, menuId: string): void {
        event.stopPropagation();
        const opening = this.openMenuId() !== menuId;
        this.openMenuId.set(opening ? menuId : null);

        if (opening && menuId === "file") {
            void this.loadRecents();
        }
    }

    /**
     * Survol d'un menu quand un autre est déjà ouvert : bascule comme une barre de menus native.
     */
    protected onMenuHover(menuId: string): void {
        if (this.openMenuId() !== null && this.openMenuId() !== menuId) {
            this.openMenuId.set(menuId);

            if (menuId === "file") {
                void this.loadRecents();
            }
        }
    }

    /**
     * Exécute l'action d'un élément de menu puis referme les menus.
     */
    protected executeMenuItem(event: MouseEvent, item: MenuItem): void {
        event.stopPropagation();

        if (item.disabled || item.separator || !item.action) {
            return;
        }

        this.closeMenus();
        item.action();
    }

    protected closeMenus(): void {
        this.openMenuId.set(null);
    }

    protected toggleSettings(event: MouseEvent): void {
        event.stopPropagation();
        this.closeMenus();
        this.shell.toggleSettings();
    }

    protected closeApp(): void {
        void this.noxus.ipc.close();
    }

    protected reduceApp(): void {
        void this.noxus.ipc.reduce();
    }

    protected toggleMaximize(): void {
        void this.noxus.ipc.toggleMaximize();
    }

    private async loadRecents(): Promise<void> {
        try {
            this.recents.set(await this.noxus.ipc.getRecentDatabases());
        }
        catch (error) {
            console.error("Failed to load recent databases:", error);
        }
    }

    /**
     * Raccourci affiché dans la langue courante.
     */
    private key(keys: string): string {
        return formatShortcut(keys, key => this.i18n.t(key));
    }

    private fileItems(): MenuItem[] {
        const t = (key: string): string => this.i18n.t(key);
        const connected = this.state.connected();
        const recents = this.recents();

        const recentItems: MenuItem[] = recents.length > 0
            ? recents.map(entry => ({
                label: `${entry.displayName} · ${entry.displaySubtitle}`,
                action: () => void this.shell.openRecent(entry),
            }))
            : [{ label: t("menu.recentEmpty"), disabled: true }];

        return [
            { label: t("menu.open"), shortcut: this.key("Ctrl+O"), action: () => void this.dbService.openFileDialog() },
            { label: t("menu.recent"), children: recentItems },
            { label: t("menu.connections"), shortcut: this.key("Ctrl+Shift+C"), action: () => void this.shell.openConnectionsManager() },
            SEPARATOR,
            { label: t("menu.newWindow"), shortcut: this.key("Ctrl+Shift+N"), action: () => void this.noxus.ipc.newWindow() },
            { label: t("menu.refresh"), shortcut: this.key("F5"), action: () => void this.shell.refresh(), disabled: !connected },
            SEPARATOR,
            {
                label: t("menu.closeTab"),
                shortcut: this.key("Ctrl+W"),
                action: () => void this.shell.closeActiveTab(),
                disabled: !connected || this.dbService.tabs.activeTabIndex() < 0,
            },
            {
                label: t(this.shell.isFileDatabase() ? "menu.closeFile" : "menu.disconnect"),
                shortcut: this.key("Ctrl+K Ctrl+F"),
                action: () => void this.dbService.closeFile(),
                disabled: !connected,
            },
            { label: t("menu.quit"), shortcut: this.key("Alt+F4"), action: () => void this.noxus.ipc.quitApp() },
        ];
    }

    private editItems(): MenuItem[] {
        const t = (key: string): string => this.i18n.t(key);
        const connected = this.state.connected();
        const capabilities = this.state.capabilities();
        const isReadOnly = this.dbService.readOnly();
        const inTransaction = this.dbService.inTransaction();
        const hasSelection = this.dbService.selectedCount() > 0;
        const hasTable = !!(this.dbService.tabs.activeTab()?.tableName ?? this.dbService.selectedTable());

        const items: MenuItem[] = [
            {
                label: t("menu.undo"),
                shortcut: this.key("Ctrl+Z"),
                action: () => void this.dbService.undoLastMutation(),
                disabled: !connected || isReadOnly || !this.dbService.mutationHistory.canUndo(),
            },
            {
                label: t("menu.redo"),
                shortcut: this.key("Ctrl+Y"),
                action: () => void this.dbService.redoLastMutation(),
                disabled: !connected || isReadOnly || !this.dbService.mutationHistory.canRedo(),
            },
            SEPARATOR,
            {
                label: t("menu.toggleEditMode"),
                shortcut: this.key("Ctrl+E"),
                checked: connected && !isReadOnly,
                action: () => this.dbService.toggleReadOnly(),
                disabled: !connected,
            },
        ];

        if (!capabilities || capabilities.transactions) {
            items.push(
                SEPARATOR,
                {
                    label: t("menu.startTransaction"),
                    shortcut: this.key("Ctrl+T"),
                    action: () => void this.dbService.transactionAction("begin"),
                    disabled: !connected || isReadOnly || inTransaction,
                },
                {
                    label: t("menu.commitTransaction"),
                    shortcut: this.key("Ctrl+Enter"),
                    action: () => void this.dbService.transactionAction("commit"),
                    disabled: !connected || !inTransaction,
                },
                {
                    label: t("menu.rollbackTransaction"),
                    shortcut: this.key("Ctrl+Shift+Z"),
                    action: () => void this.dbService.transactionAction("rollback"),
                    disabled: !connected || !inTransaction,
                },
            );
        }

        items.push(
            SEPARATOR,
            {
                label: t("menu.deleteSelection"),
                shortcut: this.key("Delete"),
                action: () => void this.dbService.deleteSelectedRows(),
                disabled: !connected || isReadOnly || !hasSelection,
            },
        );

        if (!capabilities || capabilities.importExport) {
            items.push(
                SEPARATOR,
                {
                    label: t("menu.importData"),
                    action: () => void this.shell.openImportData(),
                    disabled: !connected || isReadOnly || !hasTable,
                },
                {
                    label: t("menu.export"),
                    disabled: !connected || !hasSelection,
                    children: [
                        { label: t("menu.exportXlsx"), action: () => void this.dbService.exportData("xlsx", true) },
                        { label: t("menu.exportJson"), action: () => void this.dbService.exportData("json", true) },
                        { label: t("menu.exportCsv"), action: () => void this.dbService.exportData("csv", true) },
                    ],
                },
            );
        }

        return items;
    }

    private viewItems(): MenuItem[] {
        const t = (key: string): string => this.i18n.t(key);
        const connected = this.state.connected();
        const capabilities = this.state.capabilities();
        const currentTheme = this.themeService.currentTheme();
        const locale = this.i18n.locale();
        const items: MenuItem[] = [];

        if (!capabilities || capabilities.sqlQueries) {
            items.push({ label: t("menu.sqlEditor"), shortcut: this.key("Ctrl+Shift+S"), action: () => this.shell.openSqlEditor(), disabled: !connected });
        }

        if (!capabilities || capabilities.erDiagram) {
            items.push({ label: t("menu.erDiagram"), shortcut: this.key("Ctrl+Shift+D"), action: () => this.shell.openErDiagram(), disabled: !connected });
        }

        items.push(
            { label: t("menu.sessionDiff"), shortcut: this.key("Ctrl+Shift+M"), action: () => this.shell.openSessionDiff(), disabled: !connected },
            SEPARATOR,
            { label: t("menu.fullscreen"), shortcut: this.key("F11"), checked: this.shell.isFullscreen(), action: () => this.shell.toggleFullscreen() },
            {
                label: t("menu.theme"),
                children: ThemeService.availableThemes.map(theme => ({
                    label: t(theme.labelKey),
                    checked: currentTheme === theme.value,
                    action: () => this.themeService.applyTheme(theme.value),
                })),
            },
            {
                label: t("menu.changeTheme"),
                shortcut: this.key("Ctrl+K Ctrl+T"),
                action: () => document.dispatchEvent(new CustomEvent("open-theme-picker")),
            },
            {
                label: t("menu.language"),
                children: MENU_LOCALES.map(code => ({
                    label: this.i18n.localeLabels[code],
                    checked: locale === code,
                    action: () => this.i18n.setLocale(code),
                })),
            },
        );

        return items;
    }

    private databaseItems(): MenuItem[] {
        const t = (key: string): string => this.i18n.t(key);
        const connected = this.state.connected();
        const capabilities = this.state.capabilities();
        const isReadOnly = this.dbService.readOnly();
        const hasTable = !!(this.dbService.tabs.activeTab()?.tableName ?? this.dbService.selectedTable());
        const items: MenuItem[] = [];

        if (!capabilities || capabilities.schemaEditing) {
            items.push(
                { label: t("menu.schemaEditor"), action: () => void this.shell.openSchemaEditor(), disabled: !connected || isReadOnly || !hasTable },
                { label: t("menu.createTable"), action: () => void this.shell.openCreateTable(), disabled: !connected || isReadOnly },
                SEPARATOR,
            );
        }

        if (!capabilities || capabilities.indexes) {
            items.push({ label: t("menu.indexViewer"), action: () => void this.shell.openIndexViewer(), disabled: !connected || !hasTable });
        }

        items.push({ label: t("menu.viewSchema"), action: () => void this.shell.openDatabaseSchema(), disabled: !connected });

        if (!capabilities || capabilities.encryption) {
            items.push(
                SEPARATOR,
                { label: t("menu.changePassword"), action: () => void this.shell.openChangePassword(), disabled: !connected },
            );
        }

        return items;
    }

    private helpItems(): MenuItem[] {
        const t = (key: string): string => this.i18n.t(key);
        const updateSettings = this.updateService.settings();

        return [
            { label: t("menu.shortcuts"), shortcut: this.key("Ctrl+/"), action: () => void this.shell.openShortcuts() },
            { label: t("menu.checkForUpdates"), action: () => void this.updateService.checkNow() },
            {
                label: t("menu.autoUpdate"),
                checked: updateSettings.autoUpdate,
                disabled: !updateSettings.supported,
                action: () => void this.updateService.toggleAutoUpdate(),
            },
            SEPARATOR,
            { label: t("menu.about"), action: () => void this.shell.openAbout() },
        ];
    }
}
