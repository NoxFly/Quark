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

import { inject, Injectable, signal } from "@angular/core";
import { Router } from "@angular/router";
import type { DatabaseDriverType, DriverInfo } from "@shared/driver";
import type { ConnectionProfile, ConnectionTestResult } from "@shared/connection";
import type { RecentDatabaseEntry } from "@shared/ipc-renderer";
import type { R_ShareOpenResponse } from "@shared/share";
import { describeConnectionUri } from "src/app/shared/helpers/connection-uri.helper";
import { nextSortState } from "src/app/shared/helpers/data-grid.helper";
import { extractIpcErrorMessage } from "src/app/shared/helpers/utils";
import type {
    CreateTableColumnDef,
    DatabaseSchema,
    DbRecord,
    IndexDef,
    R_AlterTableAction,
    R_NetworkConnectBody,
    R_RemoteSqliteBody,
    R_SqlExecResponse,
    R_TestConnectionBody,
    R_TransactionAction,
    TableSchema
} from "@shared/types";
import { MutationHistoryService } from "src/app/core/services/mutation-history.service";
import { NoxusService } from "src/app/core/services/noxus.service";
import { StateService } from "src/app/core/services/state.service";
import { SessionDiffService } from "src/app/core/services/session-diff.service";
import { StoredProceduresService } from "src/app/core/services/stored-procedures.service";
import { getSpecialTab, indexesTabId, indexesTabTable, TabsService } from "src/app/core/services/tabs.service";
import { I18nService } from "src/app/core/services/i18n.service";
import { SettingsService } from "src/app/core/services/settings.service";
import { AlertController } from "@ui/alert/alert.controller";
import * as pkg from "package.json";

/**
 * Service gérant toute la logique d'interaction avec la base de données
 * via le main process.
 */
@Injectable({ providedIn: "root" })
export class DatabaseService {
    private readonly noxus = inject(NoxusService);
    private readonly state = inject(StateService);
    private readonly router = inject(Router);
    private readonly storedProcService = inject(StoredProceduresService);
    private readonly sessionDiffService = inject(SessionDiffService);
    private readonly settings = inject(SettingsService);
    private readonly i18n = inject(I18nService);
    private readonly alertCtrl = inject(AlertController);
    public readonly mutationHistory = inject(MutationHistoryService);
    public readonly tabs = inject(TabsService);

    public readonly inTransaction = signal<boolean>(false);
    public readonly selectedTable = signal<string | null>(null);
    public readonly tableData = signal<DbRecord[]>([]);
    public readonly totalCount = signal<number>(0);
    public readonly tableSchema = signal<TableSchema | null>(null);
    public readonly tableSize = signal<number>(0);
    public readonly loading = signal<boolean>(false);

    public readonly orderBy = signal<string | null>(null);
    public readonly orderDir = signal<"ASC" | "DESC">("ASC");
    public readonly filter = signal<string>("");

    public readonly selectedRowIds = signal<Set<number>>(new Set());
    public readonly allRowsSelected = signal<boolean>(false);

    /** Mode lecture seule (pas d'édition inline). */
    public readonly readOnly = signal<boolean>(true);

    /** Mode de filtre SQLite (WHERE clause) vs recherche full-text. */
    public readonly sqlFilterMode = signal<boolean>(false);

    /** Cache des informations de driver, chargé une seule fois via IPC. */
    private readonly driverInfosCache = new Map<DatabaseDriverType, DriverInfo>();

    private currentOffset = 0;

    /** Démarrage automatique de transaction en cours, partagé par les mutations concurrentes. */
    private autoTransactionPending: Promise<void> | null = null;

    /**
     * Lignes lues par page. Les lignes étant virtualisées, une page plus grande
     * ne coûte plus en rendu et réduit le nombre d'allers-retours au défilement.
     */
    private readonly pageSize = 200;

    /**
     * Ouvre le dialogue de sélection de fichier et ouvre le fichier sélectionné.
     */
    public async openFileDialog(): Promise<void> {
        const filePath = await this.noxus.ipc.openFileDialog();
        if (filePath) {
            await this.openFile(filePath);
        }
    }

    /**
     * Ouvre un fichier de base de données. Un échec est journalisé et avalé : les
     * appelants qui doivent réagir à une erreur (ex. reconnexion depuis l'historique,
     * qui propose de supprimer l'entrée si le fichier n'existe plus) utilisent
     * `openFileOrThrow`.
     * @param driverType - Driver à activer avant l'ouverture. Les appelants qui
     * connaissent le driver (ex: historique) doivent le fournir explicitement.
     * Les ouvertures via dialog ou drag-and-drop sont toujours SQLite.
     */
    public async openFile(filePath: string, driverType: import("@shared/driver").DatabaseDriverType = "sqlite"): Promise<void> {
        // Un fichier de partage s'ouvre avec son mot de passe, quelle que soit la
        // façon dont il arrive (dialogue, glisser-déposer, association de fichier).
        if (isShareFile(filePath)) {
            this.requestSharePassword(filePath);
            return;
        }

        try {
            await this.openFileOrThrow(filePath, driverType);
        }
        catch (err) {
            console.error("Failed to open file:", err);
        }
    }

    /**
     * Ouvre un fichier de base de données ; propage l'erreur au lieu de l'avaler.
     * @param driverType - Voir `openFile`.
     * @throws Si le fichier n'existe pas, n'est pas lisible, ou n'est pas une base valide.
     */
    public async openFileOrThrow(filePath: string, driverType: import("@shared/driver").DatabaseDriverType = "sqlite"): Promise<void> {
        if (isShareFile(filePath)) {
            this.requestSharePassword(filePath);
            return;
        }

        this.leaveShare();
        this.loading.set(true);

        try {
            // Réinitialise le driver avant d'ouvrir le fichier pour éviter qu'un
            // driver réseau précédemment actif parse le chemin comme une URI réseau.
            await this.noxus.ipc.setDriverType(driverType);
            const response = await this.noxus.ipc.openFile(filePath);

            if (response.needsPassword) {
                this.requirePassword(filePath);
                return;
            }

            if (response.database) {
                this.onDatabaseOpened(response.database);
            }
        }
        finally {
            this.loading.set(false);
        }
    }

    /**
     * Ouvre un fichier chiffré et le déverrouille en une seule opération.
     * Utilisé lors d'une reconnexion depuis l'historique.
     * @throws Si le fichier ne peut pas être ouvert ou si le mot de passe est incorrect.
     */
    public async openFileWithPassword(filePath: string, password: string, driverType: import("@shared/driver").DatabaseDriverType = "sqlite"): Promise<void> {
        this.leaveShare();
        this.loading.set(true);
        try {
            await this.noxus.ipc.setDriverType(driverType);
            const openResponse = await this.noxus.ipc.openFile(filePath);

            if (!openResponse.needsPassword) {
                if (openResponse.database) {
                    this.onDatabaseOpened(openResponse.database);
                }
                return;
            }

            const unlockResponse = await this.noxus.ipc.submitPassword(password);
            this.onDatabaseOpened(unlockResponse.database);
        }
        finally {
            this.loading.set(false);
        }
    }

    /**
     * @description Ouvre un fichier de partage avec son mot de passe. La connexion devient
     * une connexion partagée : ni SQL, ni export, ni modification du schéma, et en
     * consultation seule si son auteur l'a voulu.
     * @param filePath Chemin du fichier `.quarkshare`.
     * @param password Mot de passe du partage.
     * @returns Le résultat du main ; un refus y est décrit, sans lever.
     */
    public async openShare(filePath: string, password: string): Promise<R_ShareOpenResponse> {
        this.loading.set(true);

        try {
            const response = await this.noxus.ipc.shareOpen(filePath, password);

            if (!response.ok) {
                return response;
            }

            this.leaveShare();
            this.state.share.set(response.share);
            this.sqlFilterMode.set(false);

            if (response.database) {
                this.onDatabaseOpened(response.database);
            }
            else {
                this.applyNetworkConnectedState(response.driverType, response.share.name, response.share.name);
            }

            // Consultation seule : le mode édition ne peut pas être activé.
            if (response.share.readOnly) {
                this.readOnly.set(true);
            }

            return response;
        }
        finally {
            this.loading.set(false);
        }
    }

    /**
     * @description Le main a fermé la connexion partagée arrivée à échéance : la fenêtre
     * revient à l'accueil.
     */
    public onShareExpired(): void {
        this.resetConnectionState();
        this.router.navigate(["/open-database"]);
    }

    /**
     * Demande le mot de passe d'un fichier de partage (modale de mot de passe).
     */
    private requestSharePassword(filePath: string): void {
        const parts = filePath.split(/[\\/]/);
        const detail: RecentDatabaseEntry = {
            connectionType: "share",
            driverType: "sqlite",
            displayName: parts.pop() ?? filePath,
            displaySubtitle: parts.join("/"),
            lastOpened: Date.now(),
            requiresPassword: true,
            filePath,
        };

        document.dispatchEvent(new CustomEvent("open-password-prompt", { detail }));
    }

    /**
     * Une connexion ordinaire remplace la connexion partagée : ses restrictions
     * tombent avec elle (le main les lève de son côté).
     */
    private leaveShare(): void {
        this.state.share.set(null);
    }

    /**
     * @description Soumet le mot de passe de la base chiffrée en attente (`state.needsPassword`).
     * @param password Mot de passe saisi.
     * @param remember Mémoriser le mot de passe dans le trousseau du système pour les prochaines ouvertures.
     * @returns `false` si le mot de passe est refusé.
     */
    public async submitPassword(password: string, remember: boolean = false): Promise<boolean> {
        try {
            this.loading.set(true);
            const response = await this.noxus.ipc.submitPassword(password, remember);
            this.state.needsPassword.set(false);
            this.state.pendingFilePath.set(null);
            this.onDatabaseOpened(response.database);
            return true;
        }
        catch {
            return false;
        }
        finally {
            this.loading.set(false);
        }
    }

    /**
     * @description Abandonne la demande de mot de passe en cours : la base chiffrée
     * reste fermée et la fenêtre revient à la page d'accueil.
     */
    public cancelPasswordRequest(): void {
        this.state.needsPassword.set(false);
        this.state.pendingFilePath.set(null);
    }

    /**
     * Ferme le fichier en cours.
     */
    public async closeFile(): Promise<void> {
        try {
            await this.noxus.ipc.closeFile();
            this.resetConnectionState();
            this.router.navigate(["/open-database"]);
        }
        catch (err) {
            console.error("Failed to close file:", err);
        }
    }

    /**
     * Affiche la demande de mot de passe d'une base chiffrée.
     *
     * Le main a déjà fermé la base précédente pour ouvrir celle-ci : l'interface
     * doit l'oublier elle aussi, sinon elle continue d'afficher une base qui
     * n'est plus ouverte. La demande n'existe que sur la page d'ouverture, où
     * l'on se rend donc quelle que soit la page courante.
     */
    private requirePassword(filePath: string | null): void {
        this.resetConnectionState();
        this.state.needsPassword.set(true);
        this.state.pendingFilePath.set(filePath);
        this.router.navigate(["/open-database"]);
    }

    /**
     * Remet à zéro tout l'état lié à la connexion de la fenêtre.
     */
    private resetConnectionState(): void {
        this.state.connected.set(false);
        this.state.share.set(null);
        this.state.database.set(null);
        this.state.filePath.set(null);
        this.state.driverType.set(null);
        this.state.driverInfo.set(null);
        this.state.title.set(pkg.name);
        this.state.fileName.set("");
        this.selectedTable.set(null);
        this.tableData.set([]);
        this.totalCount.set(0);
        this.tableSize.set(0);
        this.tableSchema.set(null);
        this.inTransaction.set(false);
        this.selectedRowIds.set(new Set());
        this.allRowsSelected.set(false);
        this.mutationHistory.clear();
        this.storedProcService.reset();
        this.sessionDiffService.resetLocal();
        this.tabs.closeAll();
    }

    /**
     * Rafraîchit la base de données (ferme et réouvre).
     * Les onglets ouverts sont conservés, sauf ceux dont la table a disparu du
     * nouveau schéma ; l'onglet actif (ou, s'il a été fermé, son voisin) est
     * réactivé et ses données rechargées, pour que la vue affichée, la table
     * sélectionnée et l'onglet marqué actif restent cohérents.
     */
    public async refreshDatabase(): Promise<void> {
        try {
            this.loading.set(true);

            // Page hors onglets (procédure stockée) : elle reste affichée.
            const wasOutsideTabs = this.router.url.startsWith("/dashboard/stored-procedure");

            const response = await this.noxus.ipc.refreshDatabase();

            if (response.needsPassword) {
                this.requirePassword(this.state.filePath());
                return;
            }

            if (response.database) {
                // Mettre à jour le schéma sans naviguer
                this.state.connected.set(true);
                this.state.database.set(response.database);
                this.state.filePath.set(response.database.path);
                this.state.title.set(response.database.name);
                this.state.fileName.set(response.database.name);
                // driverType ne change pas lors d'un refresh, mais on s'assure que driverInfo est bien positionné
                void this.resolveAndSetDriverInfo(response.database.driverType);

                // Réinitialiser la sélection et l'historique
                this.selectedRowIds.set(new Set());
                this.allRowsSelected.set(false);
                this.mutationHistory.clear();

                await this.restoreTabsAfterRefresh(response.database, wasOutsideTabs);
            }
        }
        catch (err) {
            console.error("Failed to refresh database:", err);
        }
        finally {
            this.loading.set(false);
        }
    }

    /**
     * @description Après un rechargement du schéma : ferme les onglets dont la
     * table n'existe plus, puis réactive l'onglet actif restant (table : données
     * rechargées avec son filtre et son tri ; onglet spécial : sa route).
     * @param database - Schéma rechargé.
     * @param stayOnPage - La page affichée n'est pas un onglet : ne pas en changer.
     */
    private async restoreTabsAfterRefresh(database: DatabaseSchema, stayOnPage: boolean): Promise<void> {
        const tables = new Set(database.tables.map(t => t.name));
        const selected = this.selectedTable();

        // L'onglet actif mémorise l'état courant : si un voisin le remplace,
        // son propre filtre et son propre tri sont repris, et non ceux-ci.
        if (selected !== null && this.tabs.activeTab()?.tableName === selected) {
            this.tabs.updateActiveTab({
                filter: this.filter(),
                sqlFilterMode: this.sqlFilterMode(),
                orderBy: this.orderBy(),
                orderDir: this.orderDir(),
            });
        }

        const active = this.tabs.retainTabs(tab => {
            const indexedTable = indexesTabTable(tab.tableName);

            if (indexedTable !== null) {
                return tables.has(indexedTable);
            }

            return getSpecialTab(tab.tableName) !== null || tables.has(tab.tableName);
        });

        if (stayOnPage) {
            if (selected !== null && !tables.has(selected)) {
                this.clearSelectedTable();
            }
            return;
        }

        if (!active) {
            this.clearSelectedTable();
            await this.router.navigate(["/dashboard/no-table"]);
            return;
        }

        if (getSpecialTab(active.tableName)) {
            await this.activateTab(active.tableName);
            return;
        }

        const schema = database.tables.find(t => t.name === active.tableName) ?? null;
        // Une colonne de tri supprimée ferait échouer la requête.
        const orderBy = schema?.fields.some(f => f.name === active.orderBy) ? active.orderBy : null;

        this.selectedTable.set(active.tableName);
        this.tableSchema.set(schema);
        this.filter.set(active.filter);
        this.sqlFilterMode.set(active.sqlFilterMode);
        this.orderBy.set(orderBy);
        this.orderDir.set(orderBy === null ? "ASC" : active.orderDir);
        this.tableData.set([]);
        this.totalCount.set(0);

        await this.loadTableData(true);

        if (!this.router.url.startsWith("/dashboard/table-data")) {
            await this.router.navigate(["/dashboard/table-data"]);
        }
    }

    /**
     * @description Désélectionne la table affichée et vide ses données.
     */
    private clearSelectedTable(): void {
        this.selectedTable.set(null);
        this.tableData.set([]);
        this.totalCount.set(0);
        this.tableSchema.set(null);
    }

    /**
     * Sélectionne une table et charge ses données.
     * Gère les onglets : ouvre un onglet existant ou en crée un.
     * @param filter - Filtre imposé à l'ouverture (navigation par clé étrangère),
     * à la place de celui de l'onglet ; son mode est appliqué avec lui.
     */
    public async selectTable(tableName: string, filter?: { expression: string; sqlMode: boolean }): Promise<void> {
        // Sauvegarder l'état de l'onglet actuel avant de changer
        this.tabs.updateActiveTab({
            filter: this.filter(),
            sqlFilterMode: this.sqlFilterMode(),
            orderBy: this.orderBy(),
            orderDir: this.orderDir(),
        });

        const existingIndex = this.tabs.findTab(tableName);
        this.tabs.openTab(tableName);

        this.selectedTable.set(tableName);
        this.mutationHistory.clear();

        if (existingIndex >= 0) {
            // Restaurer l'état de l'onglet existant
            const tab = this.tabs.activeTab();
            if (tab) {
                this.filter.set(tab.filter);
                this.sqlFilterMode.set(tab.sqlFilterMode);
                this.orderBy.set(tab.orderBy);
                this.orderDir.set(tab.orderDir);
            }
        }
        else {
            // Nouvel onglet : réinitialiser
            this.currentOffset = 0;
            this.orderBy.set(null);
            this.orderDir.set("ASC");
            this.filter.set("");
        }

        if (filter) {
            this.filter.set(filter.expression);
            this.sqlFilterMode.set(filter.sqlMode);
        }

        this.selectedRowIds.set(new Set());
        this.allRowsSelected.set(false);

        const db = this.state.database();
        if (db) {
            const schema = db.tables.find(t => t.name === tableName) ?? null;
            this.tableSchema.set(schema);
        }

        await this.loadTableData(true);
        this.router.navigate(["/dashboard/table-data"]);
    }

    /**
     * Charge les données de la table sélectionnée.
     */
    public async loadTableData(reset = false): Promise<void> {
        const table = this.selectedTable();
        if (!table) {
            return;
        }

        if (reset) {
            this.currentOffset = 0;
            this.tableData.set([]);
        }

        this.loading.set(true);

        try {
            const response = await this.noxus.ipc.getTableData({
                table,
                offset: this.currentOffset,
                limit: this.pageSize,
                orderBy: this.orderBy() ?? undefined,
                orderDir: this.orderDir(),
                filter: this.filter() || undefined,
                filterMode: this.sqlFilterMode() ? "sql" : "fulltext",
            });

            if (reset) {
                this.tableData.set(response.records);
            }
            else {
                this.tableData.update(existing => [...existing, ...response.records]);
            }

            this.totalCount.set(response.totalCount);
            this.tableSize.set(response.tableSize ?? 0);
        }
        catch (err) {
            console.error("Failed to load table data:", err);
        }
        finally {
            this.loading.set(false);
        }
    }

    /**
     * Charge la page suivante (infinite scroll).
     */
    public async loadNextPage(): Promise<void> {
        // Chaque événement `scroll` proche de la fin appelle cette méthode : sans
        // cette garde, la même page était demandée plusieurs fois, puis ajoutée
        // en double.
        if (this.loading() || this.tableData().length >= this.totalCount()) {
            return;
        }

        this.currentOffset += this.pageSize;
        await this.loadTableData(false);

        // Si toutes les lignes sont sélectionnées virtuellement, ajouter les nouvelles à la sélection
        if (this.allRowsSelected()) {
            const allIds = new Set(this.tableData().map(r => r["rowid"] as number));
            this.selectedRowIds.set(allIds);
        }
    }

    /**
     * Trie la table par une colonne.
     */
    public async sortBy(column: string): Promise<void> {
        const next = nextSortState({ orderBy: this.orderBy(), orderDir: this.orderDir() }, column);

        this.orderBy.set(next.orderBy);
        this.orderDir.set(next.orderDir);

        await this.loadTableData(true);
    }

    /**
     * Applique un filtre.
     */
    public async applyFilter(filterExpr: string): Promise<void> {
        this.filter.set(filterExpr);
        await this.loadTableData(true);
    }

    /**
     * Met à jour une cellule.
     */
    public async updateCell(rowid: number, column: string, value: unknown): Promise<void> {
        this.assertWritable();

        const table = this.selectedTable();
        if (!table) {
            return;
        }

        // Obtenir la valeur courante avant mise à jour pour l'historique
        const currentRecord = this.tableData().find(r => r["rowid"] === rowid);
        const oldValue = currentRecord?.[column];

        await this.ensureAutoTransaction();
        await this.noxus.ipc.updateCell({ table, rowid, column, value });

        // Enregistrer dans l'historique
        this.mutationHistory.push({
            type: "update",
            table,
            rowid,
            column,
            oldValue,
            newValue: value,
        });

        // Mettre à jour localement
        this.tableData.update(records =>
            records.map(r => {
                if (r["rowid"] === rowid) {
                    return { ...r, [column]: value };
                }
                return r;
            })
        );
    }

    /**
     * Supprime les lignes sélectionnées.
     */
    public async deleteSelectedRows(): Promise<void> {
        const table = this.selectedTable();
        const rowids = Array.from(this.selectedRowIds());

        if (!table || rowids.length === 0) {
            return;
        }

        if (!await this.confirmDeletion(
            this.i18n.t("data.confirmDeleteRows.title", { count: rowids.length }),
            this.i18n.t("data.confirmDeleteRows.message", { count: rowids.length }),
        )) {
            return;
        }

        // Sauvegarder les records avant suppression pour l'historique
        const recordsToDelete = this.tableData().filter(r => rowids.includes(r["rowid"] as number));

        await this.ensureAutoTransaction();
        await this.noxus.ipc.deleteRows({ table, rowids });

        for (const record of recordsToDelete) {
            this.mutationHistory.push({
                type: "delete",
                table,
                rowid: record["rowid"] as number,
                oldRecord: record,
            });
        }

        this.tableData.update(records =>
            records.filter(r => !rowids.includes(r["rowid"] as number))
        );
        this.totalCount.update(c => c - rowids.length);
        this.selectedRowIds.set(new Set());
        this.updateSchemaRecordCount(table, -rowids.length);
    }

    /**
     * Supprime une seule ligne par son rowid.
     */
    public async deleteRow(rowid: number): Promise<void> {
        const table = this.selectedTable();
        if (!table) {
            return;
        }

        if (!await this.confirmDeletion(
            this.i18n.t("data.confirmDeleteRows.title", { count: 1 }),
            this.i18n.t("data.confirmDeleteRows.message", { count: 1 }),
        )) {
            return;
        }

        const record = this.tableData().find(r => r["rowid"] === rowid);

        await this.ensureAutoTransaction();
        await this.noxus.ipc.deleteRows({ table, rowids: [rowid] });

        if (record) {
            this.mutationHistory.push({
                type: "delete",
                table,
                rowid,
                oldRecord: record,
            });
        }

        this.tableData.update(records =>
            records.filter(r => (r["rowid"] as number) !== rowid)
        );
        this.totalCount.update(c => c - 1);
        this.selectedRowIds.update(set => {
            const next = new Set(set);
            next.delete(rowid);
            return next;
        });
        this.updateSchemaRecordCount(table, -1);
    }

    /**
     * Insère une nouvelle ligne dans la table courante.
     */
    public async insertRow(values: Record<string, unknown>): Promise<DbRecord | null> {
        this.assertWritable();

        const table = this.selectedTable();
        if (!table) {
            return null;
        }

        await this.ensureAutoTransaction();
        const response = await this.noxus.ipc.insertRow({ table, values });

        if (response.record) {
            this.mutationHistory.push({
                type: "insert",
                table,
                rowid: response.rowid,
                oldRecord: undefined,
                newValue: response.record,
            });
            this.tableData.update(records => [...records, response.record]);
            this.totalCount.update(c => c + 1);
            this.updateSchemaRecordCount(table, 1);
        }

        return response.record;
    }

    /**
     * Met à jour le recordCount d'une table dans le schéma stocké dans le state.
     * Appelé après insert/delete pour que la sidebar reflète le nombre correct.
     */
    private updateSchemaRecordCount(tableName: string, delta: number): void {
        const db = this.state.database();
        if (!db) {
            return;
        }

        const updatedTables = db.tables.map(t => {
            if (t.name === tableName) {
                return { ...t, recordCount: Math.max(0, t.recordCount + delta) };
            }
            return t;
        });

        this.state.database.set({ ...db, tables: updatedTables });
    }

    /**
     * Duplique une ligne existante (récupère ses valeurs puis insère une copie).
     */
    public async duplicateRow(rowid: number): Promise<DbRecord | null> {
        const table = this.selectedTable();
        if (!table) {
            return null;
        }

        const { record } = await this.noxus.ipc.getRow({ table, rowid });
        if (!record) {
            return null;
        }

        // Retirer le rowid de la copie
        const { rowid: _, ...values } = record;

        // Retirer les clés primaires auto-incrémentées
        const schema = this.tableSchema();
        if (schema) {
            for (const field of schema.fields) {
                if (field.pk) {
                    delete (values as Record<string, unknown>)[field.name];
                }
            }
        }

        return this.insertRow(values as Record<string, unknown>);
    }

    /**
     * Récupère une ligne par son rowid.
     */
    public async getRow(rowid: number): Promise<DbRecord | null> {
        const table = this.selectedTable();
        if (!table) {
            return null;
        }

        const { record } = await this.noxus.ipc.getRow({ table, rowid });
        return record;
    }

    /**
     * Gère les actions de transaction.
     */
    public async transactionAction(action: R_TransactionAction): Promise<void> {
        if (this.state.isShareReadOnly()) {
            return;
        }

        await this.noxus.ipc.transactionAction(action);

        switch (action) {
            case "begin":
                this.inTransaction.set(true);
                this.mutationHistory.clear();
                break;
            case "commit":
            case "rollback":
                this.inTransaction.set(false);
                this.mutationHistory.clear();
                if (action === "rollback") {
                    await this.loadTableData(true);
                }
                break;
        }
    }

    /**
     * Exporte les données.
     */
    public async exportData(format: "json" | "csv" | "xlsx", selectedOnly = false): Promise<void> {
        const table = this.selectedTable();
        if (!table || this.state.isShared()) {
            return;
        }

        const body: any = { table, format };

        if (selectedOnly && !this.allRowsSelected()) {
            body.rowids = Array.from(this.selectedRowIds());
        }

        if (this.filter()) {
            body.filter = this.filter();
        }

        const response = await this.noxus.ipc.exportData(body);

        // Déclencher le téléchargement
        let blob: Blob;

        if (format === "xlsx") {
            const binary = atob(response.data);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        }
        else {
            blob = new Blob([response.data], { type: format === "json" ? "application/json" : "text/csv" });
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = response.filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    /**
     * Toggle le mode lecture seule / lecture-écriture.
     */
    public toggleReadOnly(): void {
        // Un partage en consultation seule ne s'édite pas.
        if (this.state.isShareReadOnly()) {
            return;
        }

        this.readOnly.update(v => !v);
    }

    /**
     * Toggle le mode de filtre SQLite / full-text. Une connexion partagée reste en
     * recherche plein texte : un filtre SQL est une clause libre.
     */
    public toggleSqlFilterMode(): void {
        if (this.state.isShared()) {
            this.sqlFilterMode.set(false);
            return;
        }

        this.sqlFilterMode.update(v => !v);
    }

    /**
     * Toggle la sélection d'une ligne.
     */
    public toggleRowSelection(rowid: number): void {
        // Si toutes les lignes étaient sélectionnées virtuellement, matérialiser la sélection
        if (this.allRowsSelected()) {
            const allIds = new Set(this.tableData().map(r => r["rowid"] as number));
            allIds.delete(rowid);
            this.selectedRowIds.set(allIds);
            this.allRowsSelected.set(false);
            return;
        }

        this.selectedRowIds.update(set => {
            const next = new Set(set);
            if (next.has(rowid)) {
                next.delete(rowid);
            }
            else {
                next.add(rowid);
            }
            return next;
        });
    }

    /**
     * Sélectionne/désélectionne toutes les lignes (virtuellement).
     */
    public toggleSelectAll(): void {
        if (this.allRowsSelected()) {
            this.allRowsSelected.set(false);
            this.selectedRowIds.set(new Set());
        }
        else {
            this.allRowsSelected.set(true);
            // Matérialiser pour les lignes actuellement chargées
            const allIds = new Set(this.tableData().map(r => r["rowid"] as number));
            this.selectedRowIds.set(allIds);
        }
    }

    /**
     * Vérifie si une ligne est sélectionnée.
     */
    public isRowSelected(rowid: number): boolean {
        return this.allRowsSelected() || this.selectedRowIds().has(rowid);
    }

    /**
     * Retourne le nombre de lignes sélectionnées (virtuel ou réel).
     */
    public selectedCount(): number {
        return this.allRowsSelected() ? this.totalCount() : this.selectedRowIds().size;
    }

    /**
     * Restaure l'état du renderer depuis le main process (après un reload).
     */
    public async restoreState(): Promise<void> {
        try {
            const state = await this.noxus.ipc.getWindowState();
            this.inTransaction.set(state.inTransaction);

            if (state.database) {
                this.onDatabaseOpened(state.database);
            }
        }
        catch (err) {
            console.error("Failed to restore window state:", err);
        }
    }

    /**
     * Récupère les données sélectionnées sous forme de tableau de records.
     * Si allRowsSelected, retourne toutes les données chargées.
     */
    public getSelectedRecords(): DbRecord[] {
        const records = this.tableData();

        if (this.allRowsSelected()) {
            return records;
        }

        const selected = this.selectedRowIds();
        if (selected.size === 0) {
            return [];
        }

        return records.filter(r => selected.has(r["rowid"] as number));
    }

    /**
     * Appelé lorsqu'une base de données est ouverte avec succès.
     */
    private onDatabaseOpened(database: DatabaseSchema): void {
        this.state.connected.set(true);
        this.state.database.set(database);
        this.state.filePath.set(database.path);
        this.state.driverType.set(database.driverType);
        this.state.title.set(database.name);
        this.state.fileName.set(database.name);
        this.readOnly.set(!this.settings.settings().editModeOnStart);
        this.router.navigate(["/dashboard/no-table"]);
        // Résolu en arrière-plan : ne bloque pas la navigation
        void this.resolveAndSetDriverInfo(database.driverType);
    }

    /**
     * Récupère et met en cache les infos de tous les drivers (au premier appel),
     * puis positionne le driverInfo du driver actif dans le state.
     */
    private async resolveAndSetDriverInfo(driverType: DatabaseDriverType): Promise<void> {
        if (this.driverInfosCache.size === 0) {
            const infos = await this.noxus.ipc.getAllDriverInfos();
            for (const info of infos) {
                this.driverInfosCache.set(info.type, info);
            }
        }
        this.state.driverInfo.set(this.driverInfosCache.get(driverType) ?? null);
    }
    /**
     * Connexion réseau en deux phases :
     * 1. Ouvre la connexion (rapide) et navigue immédiatement vers le dashboard.
     * 2. Charge le schéma en arrière-plan avec un indicateur de chargement.
     */
    public async connectNetwork(body: R_NetworkConnectBody): Promise<void> {
        this.leaveShare();

        // Phase 1 : connexion pure — peut lever une erreur si les credentials sont invalides
        await this.noxus.ipc.connectNetwork(body);

        // Connexion établie — basculer immédiatement sur le dashboard sans attendre le schéma
        if (body.uri) {
            // L'URI peut porter les identifiants : seule sa description épurée est affichée.
            const described = describeConnectionUri(body.uri, body.driverType);
            const database = body.database || described.database;
            this.applyNetworkConnectedState(body.driverType, database, described.address);
            return;
        }

        const path = `${body.host}:${body.port}/${body.database}`;
        this.applyNetworkConnectedState(body.driverType, body.database, path);
    }

    /**
     * @description Ouvre une base SQLite distante (libSQL / Turso) dans la fenêtre.
     * Même déroulé qu'une connexion réseau : le schéma est chargé en arrière-plan.
     * @param body URL, jeton optionnel et délai de connexion.
     * @throws Si la connexion échoue (URL invalide, jeton refusé, délai dépassé).
     */
    public async connectRemoteSqlite(body: R_RemoteSqliteBody): Promise<void> {
        this.leaveShare();
        await this.noxus.ipc.connectRemoteSqlite(body);

        const described = describeConnectionUri(body.url, "libsql");
        this.applyNetworkConnectedState("libsql", described.database, described.address);
    }

    /**
     * @description Teste une connexion sans l'ouvrir dans la fenêtre (bouton « Tester »).
     * @param body Cible du test : connexion réseau, SQLite distant ou fichier local.
     * @returns Résultat du test ; une erreur de transport est rapportée comme un échec.
     */
    public async testConnection(body: R_TestConnectionBody): Promise<ConnectionTestResult> {
        try {
            return await this.noxus.ipc.testConnection(body);
        }
        catch (err) {
            return { ok: false, error: extractIpcErrorMessage(err) };
        }
    }

    /**
     * @description Rouvre une base de l'historique (page d'accueil, Ctrl+R).
     * Un fichier est rouvert directement : s'il est chiffré et que son mot de passe
     * n'est pas mémorisé dans le trousseau, la demande de mot de passe s'affiche.
     * Une connexion réseau ou distante dont le secret n'est pas conservé passe par
     * la demande de mot de passe (`open-password-prompt`).
     * @param entry Entrée de l'historique.
     * @param timeoutSeconds Délai de connexion des bases réseau.
     * @throws Si la connexion échoue (fichier introuvable, hôte injoignable, identifiants
     * refusés…) — l'appelant (page d'accueil) affiche alors une confirmation adaptée.
     */
    public async openRecentDatabase(entry: RecentDatabaseEntry, timeoutSeconds?: number): Promise<void> {
        if (entry.connectionType === "file") {
            await this.openFileOrThrow(entry.filePath ?? "", entry.driverType);
            return;
        }

        if (entry.requiresPassword) {
            document.dispatchEvent(new CustomEvent("open-password-prompt", { detail: entry }));
            return;
        }

        if (entry.connectionType === "remote") {
            await this.connectRemoteSqlite({ url: entry.url ?? "", timeoutSeconds });
            return;
        }

        await this.connectNetwork({
            driverType: entry.driverType,
            host: entry.host ?? "localhost",
            port: entry.port ?? 0,
            username: entry.username ?? "",
            password: "",
            database: entry.database ?? "",
            // Une entrée MongoDB n'a pas d'hôte/port exploitables : `uri` porte la
            // véritable chaîne de connexion (voir `DbService.openNetworkConnection`).
            uri: entry.uri,
            timeoutSeconds,
        });
    }

    /**
     * Positionne l'état renderer après une connexion réseau réussie et lance le
     * chargement du schéma en arrière-plan. Factorisé entre la connexion manuelle
     * et la connexion depuis un profil sauvegardé.
     */
    private applyNetworkConnectedState(driverType: DatabaseDriverType, database: string, path: string): void {
        this.state.connected.set(true);
        this.state.driverType.set(driverType);
        this.state.filePath.set(path);
        this.state.title.set(database);
        this.state.fileName.set(database);
        this.state.database.set({ name: database, path, tables: [], driverType });
        this.state.schemaLoading.set(true);
        this.readOnly.set(!this.settings.settings().editModeOnStart);
        void this.resolveAndSetDriverInfo(driverType);
        this.router.navigate(["/dashboard/no-table"]);

        // Chargement du schéma en arrière-plan (peut être long sur MSSQL / Azure)
        void this.loadSchemaInBackground();
    }

    /**
     * Connecte une fenêtre à partir d'un profil de connexion sauvegardé.
     * Le mot de passe est résolu côté main depuis le coffre chiffré.
     * Pour un fichier chiffré sans secret stocké, délègue au prompt de mot de passe standard.
     */
    public async connectFromProfile(profile: ConnectionProfile): Promise<void> {
        this.leaveShare();
        this.loading.set(true);
        try {
            const result = await this.noxus.ipc.connConnect(profile.id);

            if (result.needsPassword) {
                // Le main a refermé le fichier : le rouvrir place la fenêtre dans l'état
                // « mot de passe requis », ce qui affiche la modale de base chiffrée.
                await this.openFile(profile.filePath ?? "", profile.driverType);
                return;
            }

            if (result.database) {
                this.onDatabaseOpened(result.database);
            }
            else if (profile.connectionType === "network") {
                const path = `${profile.host}:${profile.port}/${profile.database}`;
                this.applyNetworkConnectedState(profile.driverType, profile.database ?? "", path);
            }
        }
        finally {
            this.loading.set(false);
        }
    }

    private async loadSchemaInBackground(): Promise<void> {
        try {
            const schema = await this.noxus.ipc.getSchema();
            if (schema) {
                this.state.database.set(schema);
            }
            // Charger les procédures stockées si le driver les supporte
            if (this.storedProcService.isSupported) {
                void this.storedProcService.loadProcedures();
            }
        }
        catch (err) {
            console.error("Failed to load schema:", err);
        }
        finally {
            this.state.schemaLoading.set(false);
        }
    }

    // --- Nouvelles fonctionnalités ---

    /**
     * Annule la dernière mutation (Ctrl+Z).
     */
    public async undoLastMutation(): Promise<void> {
        const mutation = this.mutationHistory.popForUndo();
        if (!mutation) {
            return;
        }

        const table = mutation.table;

        switch (mutation.type) {
            case "update":
                if (mutation.column !== undefined) {
                    await this.noxus.ipc.updateCell({ table, rowid: mutation.rowid, column: mutation.column, value: mutation.oldValue });
                    this.tableData.update(records =>
                        records.map(r => r["rowid"] === mutation.rowid ? { ...r, [mutation.column!]: mutation.oldValue } : r)
                    );
                }
                break;
            case "insert":
                await this.noxus.ipc.deleteRows({ table, rowids: [mutation.rowid] });
                this.tableData.update(records => records.filter(r => r["rowid"] !== mutation.rowid));
                this.totalCount.update(c => c - 1);
                break;
            case "delete":
                if (mutation.oldRecord) {
                    const { rowid: _id, ...values } = mutation.oldRecord;
                    const response = await this.noxus.ipc.insertRow({ table, values: values as Record<string, unknown> });
                    if (response.record) {
                        this.tableData.update(records => [...records, response.record]);
                        this.totalCount.update(c => c + 1);
                    }
                }
                break;
        }
    }

    /**
     * Rétablit la dernière mutation annulée (Ctrl+Y).
     */
    public async redoLastMutation(): Promise<void> {
        const mutation = this.mutationHistory.popForRedo();
        if (!mutation) {
            return;
        }

        const table = mutation.table;

        switch (mutation.type) {
            case "update":
                if (mutation.column !== undefined) {
                    await this.noxus.ipc.updateCell({ table, rowid: mutation.rowid, column: mutation.column, value: mutation.newValue });
                    this.tableData.update(records =>
                        records.map(r => r["rowid"] === mutation.rowid ? { ...r, [mutation.column!]: mutation.newValue } : r)
                    );
                }
                break;
            case "insert":
                if (mutation.newValue && typeof mutation.newValue === "object") {
                    const { rowid: _id, ...values } = mutation.newValue as DbRecord;
                    const response = await this.noxus.ipc.insertRow({ table, values: values as Record<string, unknown> });
                    if (response.record) {
                        this.tableData.update(records => [...records, response.record]);
                        this.totalCount.update(c => c + 1);
                    }
                }
                break;
            case "delete":
                await this.noxus.ipc.deleteRows({ table, rowids: [mutation.rowid] });
                this.tableData.update(records => records.filter(r => r["rowid"] !== mutation.rowid));
                this.totalCount.update(c => c - 1);
                break;
        }
    }

    /**
     * @description Refuse une écriture en lecture seule. Un formulaire (édition
     * d'enregistrement, édition par lot) peut rester ouvert quand l'utilisateur
     * repasse en lecture seule : c'est ici que son enregistrement est bloqué.
     */
    private assertWritable(): void {
        if (this.readOnly()) {
            throw new Error(this.i18n.t("data.readOnlyWriteBlocked"));
        }
    }

    /**
     * Applique la même valeur à un champ sur plusieurs lignes.
     */
    public async batchUpdate(rowids: number[], column: string, value: unknown): Promise<void> {
        this.assertWritable();

        const table = this.selectedTable();
        if (!table || rowids.length === 0) {
            return;
        }

        await this.ensureAutoTransaction();
        await this.noxus.ipc.batchUpdate({ table, rowids, column, value });

        // Enregistrer dans l'historique
        for (const rowid of rowids) {
            const record = this.tableData().find(r => r["rowid"] === rowid);
            this.mutationHistory.push({
                type: "update",
                table,
                rowid,
                column,
                oldValue: record?.[column],
                newValue: value,
            });
        }

        // Mettre à jour localement
        this.tableData.update(records =>
            records.map(r => rowids.includes(r["rowid"] as number) ? { ...r, [column]: value } : r)
        );
    }

    /**
     * Exécute une requête SQL arbitraire.
     */
    public async execSql(sql: string): Promise<R_SqlExecResponse> {
        return this.noxus.ipc.execSql({ sql });
    }

    /**
     * Lit une page supplémentaire d'un résultat SQL conservé par le main.
     */
    public async fetchSqlRows(resultId: string, offset: number, limit: number): Promise<unknown[][]> {
        const { rows } = await this.noxus.ipc.fetchSqlRows({ resultId, offset, limit });
        return rows;
    }

    /**
     * Récupère les index d'une table.
     */
    public async getIndexes(tableName: string): Promise<IndexDef[]> {
        const response = await this.noxus.ipc.getIndexes(tableName);
        return response.indexes;
    }

    /**
     * Crée un index.
     */
    public async createIndex(tableName: string, indexName: string, columns: string[], unique: boolean): Promise<void> {
        await this.noxus.ipc.createIndex({ table: tableName, name: indexName, columns, unique });
    }

    /**
     * Supprime un index.
     */
    public async dropIndex(indexName: string): Promise<void> {
        await this.noxus.ipc.dropIndex(indexName);
    }

    /**
     * Crée une nouvelle table.
     */
    public async createTable(name: string, columns: CreateTableColumnDef[]): Promise<void> {
        await this.noxus.ipc.createTable({ name, columns, ifNotExists: false });
        // Rafraîchir le schéma
        await this.refreshDatabase();
    }

    /**
     * Modifie une table (ALTER TABLE).
     */
    public async alterTable(action: R_AlterTableAction): Promise<void> {
        await this.noxus.ipc.alterTable(action);
        // Rafraîchir le schéma et les données
        await this.refreshDatabase();
        const table = this.selectedTable();
        if (table) {
            const newTableName = action.action === "rename-table" ? action.newName : table;
            await this.selectTable(newTableName);
        }
    }

    /**
     * Change le mot de passe de la base de données.
     */
    public async changePassword(newPassword: string | null): Promise<void> {
        await this.noxus.ipc.changePassword({ newPassword });
    }

    /**
     * Supprime une table et ferme son onglet s'il est ouvert.
     */
    public async deleteTable(tableName: string): Promise<void> {
        if (!await this.confirmDeletion(
            this.i18n.t("data.confirmDropTable.title", { table: tableName }),
            this.i18n.t("data.confirmDropTable.message"),
            this.i18n.t("data.confirmDropTable.confirm"),
        )) {
            return;
        }

        await this.noxus.ipc.dropTable(tableName);

        // Fermer l'onglet associé s'il est ouvert
        const tabIdx = this.tabs.findTab(tableName);
        if (tabIdx >= 0) {
            const nextTable = this.tabs.closeTab(tabIdx);
            if (nextTable) {
                await this.selectTable(nextTable);
            }
            else {
                this.selectedTable.set(null);
                this.tableData.set([]);
                this.totalCount.set(0);
                this.tableSchema.set(null);
                this.router.navigate(["/dashboard/no-table"]);
            }
        }

        await this.refreshDatabase();
    }

    /**
     * @description Vide une table (toutes ses lignes) après confirmation.
     * La confirmation est toujours demandée, quel que soit le réglage
     * `confirmDeletions` : l'opération n'est annulable que dans une transaction.
     * Le schéma n'est pas rechargé par réouverture, ce qui fermerait une
     * transaction ouverte : seuls le compteur et les données sont mis à jour.
     * @param tableName Table à vider.
     */
    public async truncateTable(tableName: string): Promise<void> {
        if (this.readOnly()) {
            return;
        }

        const confirmed = await this.confirmDanger(
            this.i18n.t("data.confirmTruncate.title", { table: tableName }),
            this.i18n.t("data.confirmTruncate.message"),
            this.i18n.t("data.confirmTruncate.confirm"),
        );

        if (!confirmed) {
            return;
        }

        await this.ensureAutoTransaction();
        await this.noxus.ipc.truncateTable(tableName);

        // Les lignes de ces mutations n'existent plus : les annuler échouerait.
        this.mutationHistory.clearTable(tableName);

        const recordCount = this.state.database()?.tables.find(t => t.name === tableName)?.recordCount ?? 0;
        this.updateSchemaRecordCount(tableName, -recordCount);

        if (this.selectedTable() === tableName) {
            this.selectedRowIds.set(new Set());
            this.allRowsSelected.set(false);
            await this.loadTableData(true);
        }
    }

    /**
     * @description Démarre une transaction avant la première mutation, si le
     * réglage `autoTransaction` est actif et que le driver les supporte. Les
     * mutations lancées en même temps (Tab pendant l'édition inline) partagent
     * le même démarrage.
     */
    private async ensureAutoTransaction(): Promise<void> {
        if (!this.settings.settings().autoTransaction || this.inTransaction()) {
            return;
        }

        if (this.state.capabilities()?.transactions !== true) {
            return;
        }

        this.autoTransactionPending ??= this.transactionAction("begin").finally(() => {
            this.autoTransactionPending = null;
        });

        await this.autoTransactionPending;
    }

    /**
     * @description Demande confirmation d'une suppression si le réglage
     * `confirmDeletions` est actif ; sinon, accepte d'emblée.
     * @param title Titre de l'alerte.
     * @param message Explication des conséquences.
     * @param confirmText Libellé du bouton de confirmation.
     * @returns `true` si la suppression peut avoir lieu.
     */
    private async confirmDeletion(title: string, message: string, confirmText?: string): Promise<boolean> {
        if (!this.settings.settings().confirmDeletions) {
            return true;
        }

        return this.confirmDanger(title, message, confirmText ?? this.i18n.t("data.confirmDelete"));
    }

    /**
     * @description Affiche une alerte de confirmation d'une action destructive.
     * @param title Titre de l'alerte.
     * @param message Explication des conséquences.
     * @param confirmText Libellé du bouton de confirmation.
     * @returns `true` si l'utilisateur a confirmé, `false` s'il a annulé ou fermé l'alerte.
     */
    private async confirmDanger(title: string, message: string, confirmText: string): Promise<boolean> {
        let confirmed = false;

        return new Promise<boolean>(resolve => {
            void this.alertCtrl.create({
                title,
                message,
                color: "danger",
                actions: [
                    { text: this.i18n.t("data.cancel"), role: "cancel" },
                    {
                        text: confirmText,
                        role: "destructive",
                        color: "danger",
                        handler: self => {
                            confirmed = true;
                            self.dismiss({ role: "destructive" });
                        },
                    },
                ],
            }).then(alert => {
                alert.didDismiss.subscribe(() => resolve(confirmed));
            });
        });
    }

    /**
     * Active un onglet par son identifiant.
     *
     * Un onglet spécial (éditeur SQL, diff de session) ne désigne pas une table :
     * le passer à `selectTable` provoquerait une requête sur une table inexistante.
     *
     * @param tableName - Identifiant porté par l'onglet.
     */
    public async activateTab(tableName: string): Promise<void> {
        const special = getSpecialTab(tableName);

        if (special) {
            this.selectedTable.set(null);
            await this.router.navigate([special.route]);
            return;
        }

        await this.selectTable(tableName);
    }

    /**
     * @description Ouvre (ou réactive) l'onglet des index d'une table.
     * @param tableName - Table dont afficher les index.
     */
    public async openIndexesTab(tableName: string): Promise<void> {
        const tabId = indexesTabId(tableName);

        this.tabs.openTab(tabId);
        await this.activateTab(tabId);
    }

    /**
     * Ferme l'onglet actif et bascule sur l'onglet adjacent.
     */
    public async closeActiveTab(): Promise<void> {
        const activeIdx = this.tabs.activeTabIndex();
        if (activeIdx < 0) {
            return;
        }
        const nextTable = this.tabs.closeTab(activeIdx);
        if (nextTable) {
            await this.activateTab(nextTable);
        }
        else {
            this.selectedTable.set(null);
            this.tableData.set([]);
            this.totalCount.set(0);
            this.tableSchema.set(null);
            this.router.navigate(["/dashboard/no-table"]);
        }
    }
}

/**
 * Un fichier de partage se reconnaît à son extension.
 */
function isShareFile(filePath: string): boolean {
    return filePath.toLowerCase().endsWith(".quarkshare");
}
