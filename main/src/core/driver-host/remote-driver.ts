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

import { Logger } from "@noxfly/noxus/main";
import { app, type UtilityProcess, utilityProcess } from "electron/main";
import { join } from "node:path";
import type { ConnectionTestResult } from "@shared/connection";
import type {
    DatabaseCategory,
    DatabaseDriverType,
    DriverCapabilities,
    DriverConnectionOptions,
    DriverInfo,
} from "@shared/driver";
import type {
    CreateTableColumnDef,
    DatabaseSchema,
    DbRecord,
    IndexDef,
    R_AlterTableAction,
    R_SqlExecResponse,
    R_SqlRowsResponse,
    StoredProcedureDetail,
    StoredProcedureExecResult,
    StoredProcedureDef,
} from "@shared/types";
import {
    DRIVER_HOST_LOG_ARG,
    type DriverHostRequest,
    type DriverHostResponse,
    type DriverHostState,
} from "src/core/driver-host/driver-host.protocol";
import type { DriverConnectionTarget } from "src/core/drivers/connection-target.types";
import type { DatabaseDriver } from "src/core/drivers/driver.interface";
import { getDriverInfo } from "src/core/drivers/driver-registry";
import { environment } from "src/core/environment";

interface PendingCall {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
}

/** Distribution de la requête sans son identifiant, attribué à l'envoi. */
type DriverHostRequestPayload =
    | Omit<Extract<DriverHostRequest, { kind: "init" }>, "id">
    | Omit<Extract<DriverHostRequest, { kind: "call" }>, "id">;

const CLOSED_STATE: DriverHostState = { isOpen: false, isInTransaction: false, path: null };

/**
 * Driver de la fenêtre, exécuté dans un utilityProcess dédié.
 *
 * Implémente `DatabaseDriver` en relayant chaque appel à l'hôte : `Window` et
 * les contrôleurs l'utilisent comme n'importe quel driver. Le process est créé
 * au premier appel et recréé si besoin après un arrêt inattendu ; les appels en
 * cours échouent alors avec un message explicite au lieu de rester bloqués.
 */
export class RemoteDriver implements DatabaseDriver {
    private child: UtilityProcess | null = null;
    private readonly pending = new Map<number, PendingCall>();
    private nextId = 1;
    private type: DatabaseDriverType = "sqlite";
    private state: DriverHostState = CLOSED_STATE;

    /** Le process a été arrêté volontairement : sa sortie n'est pas un incident. */
    private stopping = false;

    /**
     * @param onCrash - Appelé quand le process hôte s'arrête sans qu'on le lui ait
     * demandé : la connexion est perdue et l'interface doit le savoir.
     */
    public constructor(private readonly onCrash?: (wasOpen: boolean) => void) {}

    public get driverType(): DatabaseDriverType {
        return this.type;
    }

    public get info(): DriverInfo {
        return getDriverInfo(this.type);
    }

    public get category(): DatabaseCategory {
        return this.info.category;
    }

    public get capabilities(): DriverCapabilities {
        return this.info.capabilities;
    }

    public get isOpen(): boolean {
        return this.state.isOpen;
    }

    public get isInTransaction(): boolean {
        return this.state.isInTransaction;
    }

    public get path(): string | null {
        return this.state.path;
    }

    /**
     * Remplace le driver hébergé par un driver du type demandé.
     * La connexion en cours éventuelle est fermée par l'hôte.
     */
    public async switchTo(type: DatabaseDriverType): Promise<void> {
        await this.send({ kind: "init", driverType: type });
        this.type = type;
    }

    /**
     * Arrête le process hôte. Utilisé à la fermeture de la fenêtre.
     */
    public async dispose(): Promise<void> {
        if (!this.child) {
            return;
        }

        if (this.state.isOpen) {
            try {
                await this.close();
            }
            catch (error) {
                Logger.warn(`Driver close before shutdown failed: ${errorMessage(error)}`);
            }
        }

        this.stopping = true;
        this.child.kill();
        this.child = null;
    }

    // --- DatabaseDriver ---

    public configureConnection(options: DriverConnectionOptions): Promise<void> {
        return this.invoke("configureConnection", options);
    }

    public open(filePath: string): Promise<boolean> {
        return this.invoke("open", filePath);
    }

    public unlock(password: string): Promise<void> {
        return this.invoke("unlock", password);
    }

    public close(): Promise<void> {
        return this.invoke("close");
    }

    public getSchema(): Promise<DatabaseSchema> {
        return this.invoke("getSchema");
    }

    public getTablesSql(): Promise<{ name: string; sql: string }[]> {
        return this.invoke("getTablesSql");
    }

    public getTableData(
        tableName: string,
        offset: number,
        limit: number,
        orderBy?: string,
        orderDir?: "ASC" | "DESC",
        filter?: string,
        filterMode?: "sql" | "fulltext",
    ): Promise<{ records: DbRecord[]; totalCount: number; tableSize: number }> {
        return this.invoke("getTableData", tableName, offset, limit, orderBy, orderDir, filter, filterMode);
    }

    public updateCell(tableName: string, rowid: number, column: string, value: unknown): Promise<void> {
        return this.invoke("updateCell", tableName, rowid, column, value);
    }

    public deleteRows(tableName: string, rowids: number[]): Promise<void> {
        return this.invoke("deleteRows", tableName, rowids);
    }

    public getRow(tableName: string, rowid: number): Promise<DbRecord | null> {
        return this.invoke("getRow", tableName, rowid);
    }

    public insertRow(tableName: string, values: Record<string, unknown>): Promise<number> {
        return this.invoke("insertRow", tableName, values);
    }

    public batchUpdate(tableName: string, rowids: number[], column: string, value: unknown): Promise<void> {
        return this.invoke("batchUpdate", tableName, rowids, column, value);
    }

    public truncateTable(tableName: string): Promise<number> {
        return this.invoke("truncateTable", tableName);
    }

    public beginTransaction(): Promise<void> {
        return this.invoke("beginTransaction");
    }

    public commit(): Promise<void> {
        return this.invoke("commit");
    }

    public rollback(): Promise<void> {
        return this.invoke("rollback");
    }

    public exportData(
        tableName: string,
        format: "json" | "csv" | "xlsx",
        rowids?: number[],
        filter?: string,
    ): Promise<{ data: string; filename: string }> {
        return this.invoke("exportData", tableName, format, rowids, filter);
    }

    public importData(tableName: string, format: "csv" | "json", data: string, mode: "insert" | "upsert"): Promise<void> {
        return this.invoke("importData", tableName, format, data, mode);
    }

    public previewImport(
        tableName: string,
        format: "csv" | "json",
        data: string,
    ): Promise<{ preview: DbRecord[]; totalRows: number; errors: string[] }> {
        return this.invoke("previewImport", tableName, format, data);
    }

    /**
     * Exécute une requête et renvoie le résultat complet.
     * Pour l'éditeur SQL, préférer `execSqlPaged`.
     */
    public execSql(sql: string, maxRows?: number): Promise<R_SqlExecResponse> {
        return this.invoke("execSql", sql, maxRows);
    }

    public getIndexes(tableName: string): Promise<IndexDef[]> {
        return this.invoke("getIndexes", tableName);
    }

    public createIndex(tableName: string, indexName: string, columns: string[], unique: boolean): Promise<void> {
        return this.invoke("createIndex", tableName, indexName, columns, unique);
    }

    public dropIndex(indexName: string): Promise<void> {
        return this.invoke("dropIndex", indexName);
    }

    public createTable(name: string, columns: CreateTableColumnDef[], ifNotExists: boolean): Promise<void> {
        return this.invoke("createTable", name, columns, ifNotExists);
    }

    public alterTable(action: R_AlterTableAction): Promise<void> {
        return this.invoke("alterTable", action);
    }

    public dropTable(tableName: string): Promise<void> {
        return this.invoke("dropTable", tableName);
    }

    public changePassword(newPassword: string | null): Promise<void> {
        return this.invoke("changePassword", newPassword);
    }

    // --- Au-delà du contrat commun ---

    /**
     * Exécute une requête en ne rapatriant que sa première page ; la suite se
     * lit avec `fetchSqlRows` tant que `resultId` est valide.
     */
    public execSqlPaged(sql: string): Promise<R_SqlExecResponse> {
        return this.invoke("execSqlPaged", sql);
    }

    public fetchSqlRows(resultId: string, offset: number, limit: number): Promise<R_SqlRowsResponse> {
        return this.invoke("fetchSqlRows", resultId, offset, limit);
    }

    /**
     * Ouvre puis referme une connexion éphémère dans l'hôte, sans toucher au
     * driver de la fenêtre ni à sa connexion.
     */
    public testConnection(target: DriverConnectionTarget): Promise<ConnectionTestResult> {
        return this.invoke("testConnection", target);
    }

    public listStoredProcedures(): Promise<StoredProcedureDef[]> {
        this.ensureStoredProcedures();
        return this.invoke("listStoredProcedures");
    }

    public getStoredProcedureDetail(name: string, schema: string): Promise<StoredProcedureDetail> {
        this.ensureStoredProcedures();
        return this.invoke("getStoredProcedureDetail", name, schema);
    }

    public execStoredProcedure(name: string, schema: string, params: Record<string, unknown>): Promise<StoredProcedureExecResult> {
        this.ensureStoredProcedures();
        return this.invoke("execStoredProcedure", name, schema, params);
    }

    public modifyStoredProcedure(name: string, schema: string, definition: string): Promise<void> {
        this.ensureStoredProcedures();
        return this.invoke("modifyStoredProcedure", name, schema, definition);
    }

    public dropStoredProcedure(name: string, schema: string): Promise<void> {
        this.ensureStoredProcedures();
        return this.invoke("dropStoredProcedure", name, schema);
    }

    // --- Transport ---

    private ensureStoredProcedures(): void {
        this.ensureType(["mssql", "azure"], "Stored procedures");
    }

    private ensureType(types: DatabaseDriverType[], feature: string): void {
        if (!types.includes(this.type)) {
            throw new Error(`${feature} are not supported by the ${this.info.displayName} driver`);
        }
    }

    private invoke<T>(method: string, ...args: unknown[]): Promise<T> {
        return this.send({ kind: "call", method, args }) as Promise<T>;
    }

    private send(request: DriverHostRequestPayload): Promise<unknown> {
        const child = this.ensureProcess();
        const id = this.nextId++;

        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            child.postMessage({ ...request, id } satisfies DriverHostRequest);
        });
    }

    /**
     * Retourne le process hôte, en le créant au besoin.
     *
     * Un process recréé après un arrêt inattendu repart sur un driver vierge : on
     * lui renvoie le type courant avant tout autre message, l'ordre d'envoi étant
     * conservé par le canal.
     */
    private ensureProcess(): UtilityProcess {
        if (this.child) {
            return this.child;
        }

        const logFile = join(app.getPath("userData"), "logs", "quark-driver.log");

        const child = utilityProcess.fork(join(environment.rootDir, "driver-host.js"), [`${DRIVER_HOST_LOG_ARG}${logFile}`], {
            serviceName: `${environment.product.displayName} database driver`,
            stdio: "inherit",
        });

        this.child = child;
        this.stopping = false;

        child.on("message", (response: DriverHostResponse) => this.onResponse(response));
        child.on("exit", code => this.onExit(child, code));

        if (this.type !== "sqlite") {
            const id = this.nextId++;

            this.pending.set(id, {
                resolve: () => undefined,
                reject: error => Logger.error(`Driver re-initialization failed: ${error.message}`),
            });
            child.postMessage({ id, kind: "init", driverType: this.type } satisfies DriverHostRequest);
        }

        return child;
    }

    private onResponse(response: DriverHostResponse): void {
        this.state = response.state;

        const call = this.pending.get(response.id);

        if (!call) {
            return;
        }

        this.pending.delete(response.id);

        if (response.ok) {
            call.resolve(response.result);
        }
        else {
            call.reject(new Error(response.error));
        }
    }

    private onExit(child: UtilityProcess, code: number): void {
        if (this.child === child) {
            this.child = null;
        }

        const wasOpen = this.state.isOpen;
        this.state = CLOSED_STATE;

        if (!this.stopping) {
            Logger.critical(`Database driver process exited unexpectedly (code ${code}).`);
            this.onCrash?.(wasOpen);
        }

        const error = new Error("The database driver process stopped unexpectedly. The connection was closed.");

        for (const call of this.pending.values()) {
            call.reject(error);
        }

        this.pending.clear();
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
