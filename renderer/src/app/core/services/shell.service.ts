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

import { computed, DOCUMENT, inject, Injectable, signal } from "@angular/core";
import type { RecentDatabaseEntry } from "@shared/ipc-renderer";
import type { UIDismissData } from "src/app/shared/ui/ui.types";
import { DatabaseService } from "src/app/core/services/database.service";
import { NoxusService } from "src/app/core/services/noxus.service";
import { StateService } from "src/app/core/services/state.service";
import { StoredProceduresService } from "src/app/core/services/stored-procedures.service";
import { ER_DIAGRAM_TAB_ID, SESSION_DIFF_TAB_ID, SQL_EDITOR_TAB_ID, TabsService } from "src/app/core/services/tabs.service";
import { AboutComponent } from "src/app/shared/components/about/about.component";
import { ChangePasswordComponent } from "src/app/shared/components/change-password/change-password.component";
import { ConnectionsManagerComponent } from "src/app/shared/components/connections-manager/connections-manager.component";
import { CreateTableComponent } from "src/app/shared/components/create-table/create-table.component";
import { DatabaseSchemaComponent } from "src/app/shared/components/database-schema/database-schema.component";
import { ImportDataComponent } from "src/app/shared/components/import-data/import-data.component";
import { SchemaEditorComponent } from "src/app/shared/components/schema-editor/schema-editor.component";
import { ShortcutsComponent } from "src/app/shared/components/shortcuts/shortcuts.component";
import { ModalController } from "src/app/shared/ui/components/modal/modal.controller";

/**
 * Actions de la coquille de l'application (titlebar, raccourcis, barre d'état,
 * page d'accueil) : ouverture des modales et des onglets dédiés, page Paramètres,
 * plein écran.
 *
 * Ces actions étaient dupliquées entre la titlebar et `AppComponent` ; les
 * regrouper ici garantit qu'un menu, un raccourci et un lien de l'accueil
 * déclenchent exactement le même comportement.
 */
@Injectable({ providedIn: "root" })
export class ShellService {
    private readonly document = inject(DOCUMENT);
    private readonly noxus = inject(NoxusService);
    private readonly state = inject(StateService);
    private readonly dbService = inject(DatabaseService);
    private readonly tabsService = inject(TabsService);
    private readonly storedProcService = inject(StoredProceduresService);
    private readonly modalCtrl = inject(ModalController);

    /** La page Paramètres recouvre l'espace de travail (ou l'accueil). */
    public readonly settingsOpen = signal<boolean>(false);

    /**
     * La fenêtre est en plein écran (F11). Le main n'expose pas cet état : on le
     * déduit de la taille de la fenêtre, qui couvre alors l'écran entier, barre
     * des tâches comprise — ce qu'une fenêtre maximisée ne fait pas.
     */
    public readonly isFullscreen = signal<boolean>(false);

    /**
     * La base ouverte est un fichier local (SQLite). Tout autre driver — réseau,
     * ou SQLite distant (libSQL) — est une connexion : les libellés de fermeture
     * (« Fermer le fichier » / « Fermer la connexion ») en dépendent.
     */
    public readonly isFileDatabase = computed<boolean>(() => this.state.driverType() === "sqlite");

    public constructor() {
        const view = this.document.defaultView;

        if (view) {
            const update = (): void => this.isFullscreen.set(
                view.innerWidth >= view.screen.width && view.innerHeight >= view.screen.height,
            );
            view.addEventListener("resize", update);
            update();
        }
    }

    /**
     * @description Affiche la page Paramètres par-dessus l'espace de travail.
     */
    public openSettings(): void {
        this.settingsOpen.set(true);
    }

    /**
     * @description Referme la page Paramètres et revient à la vue précédente, intacte.
     */
    public closeSettings(): void {
        this.settingsOpen.set(false);
    }

    /**
     * @description Ouvre ou referme la page Paramètres (bouton Paramètres de la titlebar).
     */
    public toggleSettings(): void {
        this.settingsOpen.update(open => !open);
    }

    /**
     * @description Bascule le plein écran de la fenêtre.
     */
    public toggleFullscreen(): void {
        void this.noxus.ipc.toggleFullscreen();
    }

    /**
     * @description Recharge le schéma de la base (et ses procédures stockées si le driver en a).
     */
    public async refresh(): Promise<void> {
        if (!this.state.connected()) {
            return;
        }

        await this.dbService.refreshDatabase();

        if (this.state.capabilities()?.storedProcedures) {
            await this.storedProcService.loadProcedures();
        }
    }

    /**
     * @description Ouvre (ou active) l'onglet de l'éditeur SQL.
     */
    public openSqlEditor(): void {
        const capabilities = this.state.capabilities();

        if (capabilities && !capabilities.sqlQueries) {
            return;
        }

        this.openSpecialTab(SQL_EDITOR_TAB_ID);
    }

    /**
     * @description Ouvre (ou active) l'onglet du diagramme entité-relation.
     */
    public openErDiagram(): void {
        const capabilities = this.state.capabilities();

        if (capabilities && !capabilities.erDiagram) {
            return;
        }

        this.openSpecialTab(ER_DIAGRAM_TAB_ID);
    }

    /**
     * @description Ouvre (ou active) l'onglet des modifications depuis l'ouverture (diff de session).
     */
    public openSessionDiff(): void {
        this.openSpecialTab(SESSION_DIFF_TAB_ID);
    }

    /**
     * @description Ferme l'onglet actif (Ctrl+W, Fichier › Fermer).
     */
    public async closeActiveTab(): Promise<void> {
        if (this.state.connected() && this.tabsService.activeTabIndex() >= 0) {
            await this.dbService.closeActiveTab();
        }
    }

    /**
     * @description Rouvre une base de l'historique « récents ».
     * Une entrée qui exige un secret (fichier chiffré, serveur, URL distante dont
     * le jeton n'est pas conservé) passe par la demande de mot de passe.
     * @param entry Entrée renvoyée par `getRecentDatabases`.
     */
    public async openRecent(entry: RecentDatabaseEntry): Promise<void> {
        this.closeSettings();

        if (entry.requiresPassword || entry.connectionType === "remote") {
            this.document.dispatchEvent(new CustomEvent("open-password-prompt", { detail: entry }));
            return;
        }

        if (entry.connectionType === "network") {
            await this.dbService.connectNetwork({
                driverType: entry.driverType,
                host: entry.host ?? "localhost",
                port: entry.port ?? 0,
                username: entry.username ?? "",
                password: "",
                database: entry.database ?? "",
            });
            return;
        }

        await this.dbService.openFile(entry.filePath ?? "", entry.driverType);
    }

    /**
     * @description Ouvre la modale des raccourcis clavier.
     */
    public async openShortcuts(): Promise<void> {
        const { modal, component } = await this.openModal<ShortcutsComponent>(ShortcutsComponent, {}, true);

        if (component) {
            component.dismiss = () => modal.dismiss();
        }
    }

    /**
     * @description Ouvre la modale « À propos de Quark ».
     */
    public async openAbout(): Promise<void> {
        const { modal, component } = await this.openModal<AboutComponent>(AboutComponent, {}, true);

        if (component) {
            component.dismiss = () => modal.dismiss();
        }
    }

    /**
     * @description Ouvre le gestionnaire de connexions sauvegardées (coffre chiffré).
     */
    public async openConnectionsManager(): Promise<void> {
        const { modal, component } = await this.openModal<ConnectionsManagerComponent>(ConnectionsManagerComponent, {}, true);

        if (component) {
            component.dismiss = () => modal.dismiss();
        }
    }

    /**
     * @description Ouvre la modale de visualisation du schéma de la base.
     */
    public async openDatabaseSchema(): Promise<void> {
        const { modal, component } = await this.openModal<DatabaseSchemaComponent>(DatabaseSchemaComponent, {}, true);

        if (component) {
            component.dismiss = () => modal.dismiss();
        }
    }

    /**
     * @description Ouvre l'import de données dans la table active, puis recharge ses lignes.
     */
    public async openImportData(): Promise<void> {
        const table = this.dbService.selectedTable();

        if (!table) {
            return;
        }

        const { modal, component } = await this.openModal<ImportDataComponent>(ImportDataComponent, { tableName: table }, false);

        if (component) {
            component.dismiss = data => modal.dismiss(data as Partial<UIDismissData>);
        }

        modal.didDismiss.subscribe(async result => {
            if (result.data?.["imported"] === true) {
                await this.dbService.loadTableData(true);
            }
        });
    }

    /**
     * @description Ouvre l'éditeur de schéma de la table active et applique les modifications validées.
     */
    public async openSchemaEditor(): Promise<void> {
        const table = this.dbService.selectedTable();
        const fields = this.dbService.tableSchema()?.fields ?? [];

        if (!table || fields.length === 0) {
            return;
        }

        const { modal, component } = await this.openModal<SchemaEditorComponent>(
            SchemaEditorComponent,
            { tableName: table, fields },
            false,
        );

        if (component) {
            component.dismiss = async data => {
                if (data?.["changed"] === true) {
                    for (const action of component.getAlterActions()) {
                        await this.dbService.alterTable(action);
                    }
                }
                modal.dismiss(data as Partial<UIDismissData>);
            };
        }
    }

    /**
     * @description Ouvre la création d'une table, puis recharge le schéma.
     */
    public async openCreateTable(): Promise<void> {
        const { modal, component } = await this.openModal<CreateTableComponent>(CreateTableComponent, {}, false);

        if (component) {
            component.dismiss = data => modal.dismiss(data as Partial<UIDismissData>);
        }

        modal.didDismiss.subscribe(async result => {
            if (result.role === "confirm") {
                await this.dbService.refreshDatabase();
            }
        });
    }

    /**
     * @description Ouvre la visualisation des index de la table active.
     */
    public async openIndexViewer(): Promise<void> {
        const table = this.dbService.selectedTable();

        if (!table) {
            return;
        }

        // Les index s'affichent dans un onglet dédié (« Index · table »), plus une modale.
        await this.dbService.openIndexesTab(table);
    }

    /**
     * @description Ouvre la gestion du chiffrement (mot de passe SQLCipher) de la base.
     */
    public async openChangePassword(): Promise<void> {
        const { modal, component } = await this.openModal<ChangePasswordComponent>(ChangePasswordComponent, {}, false);

        if (component) {
            component.dismiss = data => modal.dismiss(data as Partial<UIDismissData>);
        }
    }

    /**
     * Ouvre un onglet non tabulaire. La page Paramètres est refermée : l'utilisateur
     * qui demande une vue veut la voir, pas rester sur les réglages.
     */
    private openSpecialTab(tabId: string): void {
        if (!this.state.connected()) {
            return;
        }

        this.closeSettings();
        this.tabsService.openTab(tabId);
        void this.dbService.activateTab(tabId);
    }

    /**
     * Crée une modale avec les options communes à toutes celles de la coquille.
     */
    private async openModal<T>(
        component: new (...args: never[]) => T,
        componentProps: Record<string, unknown>,
        backdropClose: boolean,
    ): Promise<{ modal: Awaited<ReturnType<ModalController["create"]>>; component: T | undefined }> {
        const modal = await this.modalCtrl.create({
            component,
            componentProps,
            backdropClose,
            showDots: false,
            blurry: false,
        });

        return { modal, component: modal.getComponentInstance<T>() };
    }
}
