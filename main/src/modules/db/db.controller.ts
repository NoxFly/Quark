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

import { Controller, Get, inject, Post, type Request } from "@noxfly/noxus/main";
import { shell } from "electron/common";
import type { ConnectionTestResult } from "@shared/connection";
import type { DatabaseDriverType, DriverInfo } from "@shared/driver";
import type { RecentDatabaseEntry } from "@shared/ipc-renderer";
import type {
    DatabaseSchema,
    R_AlterTableAction,
    R_BatchUpdateBody,
    R_ChangePasswordBody,
    R_CloseFileResponse,
    R_ConnectNetworkResponse,
    R_CreateIndexBody,
    R_CreateTableBody,
    R_DeleteRowsBody,
    R_ExportBody,
    R_ExportResponse,
    R_GetIndexesResponse,
    R_GetRowBody,
    R_GetRowResponse,
    R_ImportDataBody,
    R_ImportPreviewResponse,
    R_InsertRowBody,
    R_InsertRowResponse,
    R_NetworkConnectBody,
    R_OpenFileBody,
    R_OpenFileResponse,
    R_PasswordBody,
    R_PasswordResponse,
    R_RemoteSqliteBody,
    R_SqlExecBody,
    R_SqlExecResponse,
    R_SqlRowsBody,
    R_SqlRowsResponse,
    R_StoredProcDetailBody,
    R_StoredProcDropBody,
    R_StoredProcExecBody,
    R_StoredProcListResponse,
    R_StoredProcModifyBody,
    R_TableDataBody,
    R_TableDataResponse,
    R_TestConnectionBody,
    R_TransactionAction,
    R_UpdateCellBody,
    StoredProcedureDetail,
    StoredProcedureExecResult,
} from "@shared/types";
import { getAllDriverInfos } from "src/core/drivers/driver-registry";
import type { ShareOperation, Window } from "src/core/services/window";
import { Application } from "src/modules/application";
import { ConnectionsService } from "src/modules/connections/connections.service";
import { DbService } from "src/modules/db/db.service";

/**
 * Base de données de la fenêtre appelante.
 *
 * Les lectures sont des `GET`, tout ce qui modifie la base ou l'état de la
 * connexion est un `POST`. Les mutations de lignes passent par `Window`, qui
 * capture les images avant/après pour le diff de session.
 */
@Controller()
export class DbController {
    private readonly application = inject(Application);
    private readonly dbService = inject(DbService);
    private readonly connections = inject(ConnectionsService);

    // --- Connexion ---

    @Post("open-file")
    public async openFile(request: Request): Promise<R_OpenFileResponse> {
        const { filePath } = request.body as R_OpenFileBody;
        return await this.dbService.openFile(this.window(request), filePath);
    }

    @Post("submit-password")
    public async submitPassword(request: Request): Promise<R_PasswordResponse> {
        const { password, remember } = request.body as R_PasswordBody;
        const database = await this.dbService.submitPassword(this.window(request), password, remember === true);

        if (!database) {
            throw new Error("Database is not open");
        }

        return { database };
    }

    @Post("close")
    public async close(request: Request): Promise<R_CloseFileResponse> {
        await this.window(request).closeDatabase();
        return { closed: true };
    }

    @Post("refresh")
    public async refresh(request: Request): Promise<R_OpenFileResponse> {
        return await this.dbService.refresh(this.window(request));
    }

    @Post("set-driver-type")
    public async setDriverType(request: Request): Promise<void> {
        const { type } = request.body as { type: DatabaseDriverType };
        await this.window(request).setDriverType(type);
    }

    /**
     * Connexion pure : le schéma est chargé à part (`db/schema`) pour répondre
     * immédiatement.
     */
    @Post("connect-network")
    public async connectNetwork(request: Request): Promise<R_ConnectNetworkResponse> {
        await this.dbService.openNetworkConnection(this.window(request), request.body as R_NetworkConnectBody);
        return { connected: true };
    }

    /**
     * Base SQLite distante (libSQL / Turso). Comme une connexion réseau, le
     * schéma est chargé à part.
     */
    @Post("connect-remote-sqlite")
    public async connectRemoteSqlite(request: Request): Promise<R_ConnectNetworkResponse> {
        await this.dbService.openRemoteSqlite(this.window(request), request.body as R_RemoteSqliteBody);
        return { connected: true };
    }

    /**
     * Test d'une connexion, sans effet sur la base de la fenêtre. Un `POST` : le
     * test ouvre une connexion sur le serveur, ce n'est pas une simple lecture.
     */
    @Post("test-connection")
    public async testConnection(request: Request): Promise<ConnectionTestResult> {
        const body = this.connections.withStoredSecret(request.body as R_TestConnectionBody);
        return await this.dbService.testConnection(this.window(request), body);
    }

    @Get("schema")
    public async getSchema(request: Request): Promise<DatabaseSchema | null> {
        const window = this.application.getWindowBySenderId(request.senderId);
        return window ? await window.getDatabaseSchema() : null;
    }

    @Get("recent")
    public getRecent(): RecentDatabaseEntry[] {
        return this.application.getRecentDatabases();
    }

    @Post("recent/remove")
    public removeRecent(request: Request): void {
        this.application.removeRecentDatabase(request.body as RecentDatabaseEntry);
    }

    /** Révèle un fichier dans l'explorateur du système (menu contextuel d'une base récente). */
    @Post("reveal-in-explorer")
    public revealInExplorer(request: Request): void {
        const { filePath } = request.body as { filePath: string };
        shell.showItemInFolder(filePath);
    }

    @Get("driver-infos")
    public getDriverInfos(): DriverInfo[] {
        return getAllDriverInfos();
    }

    // --- Données ---

    @Get("table-data")
    public async getTableData(request: Request): Promise<R_TableDataResponse> {
        const body = request.body as R_TableDataBody;
        // Un filtre SQL est une clause libre : sur une connexion partagée, il
        // contournerait l'absence d'éditeur SQL.
        const window = body.filterMode === "sql" ? this.restricted(request, "sql") : this.window(request);

        return await window.database.getTableData(
            body.table,
            body.offset,
            body.limit,
            body.orderBy,
            body.orderDir,
            body.filter,
            body.filterMode,
        );
    }

    @Get("row")
    public async getRow(request: Request): Promise<R_GetRowResponse> {
        const body = request.body as R_GetRowBody;
        return { record: await this.window(request).database.getRow(body.table, body.rowid) };
    }

    @Post("update-cell")
    public async updateCell(request: Request): Promise<void> {
        const body = request.body as R_UpdateCellBody;
        await this.window(request).updateCell(body.table, body.rowid, body.column, body.value);
    }

    @Post("batch-update")
    public async batchUpdate(request: Request): Promise<void> {
        const body = request.body as R_BatchUpdateBody;
        await this.window(request).batchUpdate(body.table, body.rowids, body.column, body.value);
    }

    @Post("insert-row")
    public async insertRow(request: Request): Promise<R_InsertRowResponse> {
        const body = request.body as R_InsertRowBody;
        return (await this.window(request).insertRow(body.table, body.values)) as R_InsertRowResponse;
    }

    @Post("delete-rows")
    public async deleteRows(request: Request): Promise<void> {
        const body = request.body as R_DeleteRowsBody;
        await this.window(request).deleteRows(body.table, body.rowids);
    }

    @Post("transaction")
    public async transaction(request: Request): Promise<void> {
        const { action } = request.body as { action: R_TransactionAction };
        await this.window(request).transactionAction(action);
    }

    // --- SQL ---

    @Post("exec-sql")
    public async execSql(request: Request): Promise<R_SqlExecResponse> {
        const { sql } = request.body as R_SqlExecBody;
        return await this.dbService.execSql(this.restricted(request, "sql"), sql);
    }

    @Get("sql-rows")
    public async getSqlRows(request: Request): Promise<R_SqlRowsResponse> {
        const body = request.body as R_SqlRowsBody;
        return await this.restricted(request, "sql").database.fetchSqlRows(body.resultId, body.offset, body.limit);
    }

    @Get("tables-sql")
    public async getTablesSql(request: Request): Promise<{ name: string; sql: string }[]> {
        return await this.window(request).database.getTablesSql();
    }

    // --- Import / export ---

    @Get("export")
    public async exportData(request: Request): Promise<R_ExportResponse> {
        const body = request.body as R_ExportBody;
        return await this.restricted(request, "export").database.exportData(body.table, body.format, body.rowids, body.filter);
    }

    @Get("preview-import")
    public async previewImport(request: Request): Promise<R_ImportPreviewResponse> {
        const body = request.body as Omit<R_ImportDataBody, "mode">;
        return await this.restricted(request, "schema").database.previewImport(body.table, body.format, body.data);
    }

    @Post("import")
    public async importData(request: Request): Promise<void> {
        await this.dbService.importData(this.restricted(request, "schema"), request.body as R_ImportDataBody);
    }

    // --- Schéma ---

    @Get("indexes")
    public async getIndexes(request: Request): Promise<R_GetIndexesResponse> {
        const { table } = request.body as { table: string };
        return { indexes: await this.window(request).database.getIndexes(table) };
    }

    @Post("create-index")
    public async createIndex(request: Request): Promise<void> {
        await this.dbService.createIndex(this.restricted(request, "schema"), request.body as R_CreateIndexBody);
    }

    @Post("drop-index")
    public async dropIndex(request: Request): Promise<void> {
        const { name } = request.body as { name: string };
        await this.dbService.dropIndex(this.restricted(request, "schema"), name);
    }

    @Post("create-table")
    public async createTable(request: Request): Promise<void> {
        await this.dbService.createTable(this.restricted(request, "schema"), request.body as R_CreateTableBody);
    }

    @Post("alter-table")
    public async alterTable(request: Request): Promise<void> {
        await this.dbService.alterTable(this.restricted(request, "schema"), request.body as R_AlterTableAction);
    }

    @Post("drop-table")
    public async dropTable(request: Request): Promise<void> {
        const { table } = request.body as { table: string };
        await this.dbService.dropTable(this.restricted(request, "schema"), table);
    }

    @Post("truncate-table")
    public async truncateTable(request: Request): Promise<void> {
        const { table } = request.body as { table: string };
        await this.dbService.truncateTable(this.restricted(request, "schema"), table);
    }

    @Post("change-password")
    public async changePassword(request: Request): Promise<void> {
        const { newPassword } = request.body as R_ChangePasswordBody;
        await this.dbService.changePassword(this.restricted(request, "schema"), newPassword);
    }

    // --- Procédures stockées (MSSQL / Azure) ---

    @Get("stored-procedures")
    public async listStoredProcedures(request: Request): Promise<R_StoredProcListResponse> {
        return { procedures: await this.window(request).database.listStoredProcedures() };
    }

    @Get("stored-procedure-detail")
    public async getStoredProcedureDetail(request: Request): Promise<StoredProcedureDetail> {
        const body = request.body as R_StoredProcDetailBody;
        return await this.window(request).database.getStoredProcedureDetail(body.name, body.schema);
    }

    @Post("stored-procedure-exec")
    public async execStoredProcedure(request: Request): Promise<StoredProcedureExecResult> {
        const body = request.body as R_StoredProcExecBody;
        return await this.restricted(request, "schema").database.execStoredProcedure(body.name, body.schema, body.params);
    }

    @Post("stored-procedure-modify")
    public async modifyStoredProcedure(request: Request): Promise<void> {
        const body = request.body as R_StoredProcModifyBody;
        await this.restricted(request, "schema").database.modifyStoredProcedure(body.name, body.schema, body.definition);
    }

    @Post("stored-procedure-drop")
    public async dropStoredProcedure(request: Request): Promise<void> {
        const body = request.body as R_StoredProcDropBody;
        await this.restricted(request, "schema").database.dropStoredProcedure(body.name, body.schema);
    }

    private window(request: Request): Window {
        return this.application.requireWindow(request.senderId);
    }

    /**
     * Fenêtre appelante, après vérification que l'opération est permise sur sa
     * connexion (restrictions d'une connexion partagée).
     */
    private restricted(request: Request, operation: ShareOperation): Window {
        const window = this.window(request);
        window.assertShareAllows(operation);
        return window;
    }
}
