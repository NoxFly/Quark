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

import { Logger } from "@noxfly/noxus";
import type {
    CreateTableColumnDef,
    DatabaseSchema,
    DbRecord,
    FieldDef,
    ForeignKeyDef,
    IndexDef,
    R_AlterTableAction,
    R_SqlExecResponse,
    TableSchema,
} from "@shared/types";
import type { DatabaseCategory, DatabaseDriverType, DriverCapabilities, DriverInfo } from "@shared/driver";
import type { DatabaseDriver } from "src/core/drivers/driver.interface";
import { getDriverInfo } from "src/core/drivers/driver-registry";

/**
 * Configuration de connexion parsée depuis une URI.
 */
export interface NetworkConnectionParams {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
}

/**
 * Résultat brut d'une requête SQL exécutée par un driver réseau.
 */
export interface RawQueryResult {
    rows: Record<string, unknown>[];
    affectedRows: number;
    insertId?: number;
}

/**
 * Classe abstraite pour les drivers SQL réseau (MySQL, MariaDB, PostgreSQL, Oracle, MSSQL).
 * Fournit la logique commune : parsing d'URI, export/import, CSV helpers, etc.
 * Chaque sous-classe implémente les méthodes de connexion/requête spécifiques à sa bibliothèque.
 */
export abstract class NetworkSqlDriver implements DatabaseDriver {
    protected connectionParams: NetworkConnectionParams | null = null;
    protected _isOpen = false;
    protected _inTransaction = false;

    // --- Identité (implémentée par chaque sous-classe) ---

    public abstract readonly driverType: DatabaseDriverType;
    public readonly category: DatabaseCategory = "sql";

    public get info(): DriverInfo {
        return getDriverInfo(this.driverType);
    }

    public get capabilities(): DriverCapabilities {
        return this.info.capabilities;
    }

    public get isOpen(): boolean {
        return this._isOpen;
    }

    public get isInTransaction(): boolean {
        return this._inTransaction;
    }

    public get path(): string | null {
        if (!this.connectionParams) {
            return null;
        }
        const p = this.connectionParams;
        return `${p.host}:${p.port}/${p.database}`;
    }

    // --- Parsing de l'URI de connexion ---

    /**
     * Parse une URI de connexion au format :
     * `user:password@host:port/database`
     */
    protected parseConnectionUri(uri: string): NetworkConnectionParams {
        const defaultPort = this.info.defaultPort ?? 3306;

        // Format: user:password@host:port/database
        const match = uri.match(/^(?<user>[^:]+):(?<password>[^@]+)@(?<host>[^:/]+)(?::(?<port>\d+))?\/(?<database>.+)$/);

        if (!match?.groups) {
            throw new Error(`Invalid connection URI format. Expected: user:password@host:port/database`);
        }

        return {
            user: match.groups["user"],
            password: match.groups["password"],
            host: match.groups["host"],
            port: match.groups["port"] ? Number.parseInt(match.groups["port"], 10) : defaultPort,
            database: match.groups["database"],
        };
    }

    // --- Cycle de vie ---

    public async open(connectionUri: string): Promise<boolean> {
        await this.close();
        this.connectionParams = this.parseConnectionUri(connectionUri);

        try {
            await this.connect();
            this._isOpen = true;
            Logger.info(`Connected to ${this.driverType}: ${this.path}`);
            return false; // Les drivers réseau n'ont pas besoin de mot de passe séparé
        }
        catch (err) {
            this.connectionParams = null;
            throw new Error(`Failed to connect to ${this.driverType}: ${err}`);
        }
    }

    public async unlock(_password: string): Promise<void> {
        throw new Error(`${this.driverType} does not support encryption/unlock`);
    }

    public async close(): Promise<void> {
        if (this._inTransaction) {
            try {
                await this.rollback();
            }
            catch {
                // Ignorer les erreurs de rollback lors de la fermeture
            }
        }

        await this.disconnect();
        this._isOpen = false;
        this.connectionParams = null;
        this._inTransaction = false;
    }

    // --- Méthodes abstraites que chaque driver doit implémenter ---

    /** Établit la connexion au serveur. */
    protected abstract connect(): Promise<void>;

    /** Ferme la connexion au serveur. */
    protected abstract disconnect(): Promise<void>;

    /** Exécute une requête SQL et retourne les résultats bruts. */
    protected abstract query(sql: string, params?: unknown[]): Promise<RawQueryResult>;

    /** Exécute une requête SQL sans retourner de résultats. */
    protected abstract execute(sql: string, params?: unknown[]): Promise<{ affectedRows: number; insertId?: number }>;

    /** Récupère les tables de la base. */
    protected abstract fetchTables(): Promise<string[]>;

    /** Récupère le schéma d'une table. */
    protected abstract fetchTableSchema(tableName: string): Promise<{ fields: FieldDef[]; recordCount: number }>;

    /** Récupère les foreign keys d'une table. */
    protected abstract fetchForeignKeys(tableName: string): Promise<Map<string, ForeignKeyDef>>;

    /** Échappement d'identifiant spécifique au driver. */
    protected abstract escapeIdentifier(name: string): string;

    /** Récupère le SQL de création des tables. */
    protected abstract fetchTablesSql(): Promise<{ name: string; sql: string }[]>;

    /** Récupère les index d'une table via les requêtes système du driver. */
    protected abstract fetchIndexes(tableName: string): Promise<IndexDef[]>;

    // --- Schéma ---

    public async getSchema(): Promise<DatabaseSchema> {
        this.ensureOpen();

        const tables = await this.fetchTables();
        const tableSchemas: TableSchema[] = [];

        for (const tableName of tables) {
            const { fields, recordCount } = await this.fetchTableSchema(tableName);
            tableSchemas.push({ name: tableName, fields, weight: 0, recordCount });
        }

        return {
            name: this.connectionParams!.database,
            path: this.path!,
            tables: tableSchemas,
            driverType: this.driverType,
        };
    }

    public async getTablesSql(): Promise<{ name: string; sql: string }[]> {
        this.ensureOpen();
        return await this.fetchTablesSql();
    }

    // --- Données ---

    /**
     * Extrait la clause ORDER BY du filtre SQL s'il existe.
     * Retourne { whereClause, orderClause } où orderClause est vide ou commence par " ORDER BY".
     */
    protected extractOrderByFromFilter(filter: string): { whereClause: string; orderClause: string } {
        const trimmed = filter.trim();

        // Vérifier si le filtre commence par ORDER BY
        if (trimmed.match(/^\s*ORDER\s+BY\s+/i)) {
            return { whereClause: "", orderClause: trimmed };
        }

        // Chercher "ORDER BY" dans le filtre
        const orderByMatch = trimmed.match(/^([\s\S]*?)\s+(ORDER\s+BY\s+[\s\S]+)$/i);

        if (!orderByMatch) {
            return { whereClause: trimmed, orderClause: "" };
        }

        const whereClause = orderByMatch[1].trim();
        const orderByPart = orderByMatch[2];

        return {
            whereClause,
            orderClause: orderByPart // Trimmed, sans espace avant
        };
    }

    public async getTableData(
        tableName: string,
        offset: number,
        limit: number,
        orderBy?: string,
        orderDir?: "ASC" | "DESC",
        filter?: string,
        filterMode: "sql" | "fulltext" = "fulltext",
    ): Promise<{ records: DbRecord[]; totalCount: number; tableSize: number }> {
        this.ensureOpen();

        const safeTable = this.escapeIdentifier(tableName);
        let whereClause = "";
        let filterOrderClause = "";
        const whereParams: unknown[] = [];

        if (filter && filter.trim().length > 0) {
            if (filterMode === "sql") {
                // Extraire l'ORDER BY du filtre s'il existe
                const { whereClause: sqlWhere, orderClause: sqlOrder } = this.extractOrderByFromFilter(filter);
                filterOrderClause = sqlOrder;

                // Ne construire whereClause que s'il y a une condition WHERE
                if (sqlWhere.trim().length > 0) {
                    whereClause = ` WHERE ${sqlWhere}`;
                }
                // Si sqlWhere est vide (juste ORDER BY), pas de WHERE clause
            }
            else {
                const { fields } = await this.fetchTableSchema(tableName);
                const conditions = fields.map(f => `CAST(${this.escapeIdentifier(f.name)} AS CHAR) LIKE ?`);
                whereClause = ` WHERE (${conditions.join(" OR ")})`;
                const likeParam = `%${filter.trim()}%`;
                whereParams.push(...fields.map(() => likeParam));
            }
        }

        const countSql = `SELECT COUNT(*) AS cnt FROM ${safeTable}${whereClause}`;
        const countResult = await this.query(countSql, whereParams);
        const totalCount = Number(countResult.rows[0]?.["cnt"] ?? 0);

        let orderClause = "";
        if (filterOrderClause) {
            // Utiliser l'ORDER BY du filtre s'il existe (ajouter l'espace avant)
            orderClause = ` ${filterOrderClause}`;
        }
        else if (orderBy) {
            const dir = orderDir === "DESC" ? "DESC" : "ASC";
            orderClause = ` ORDER BY ${this.escapeIdentifier(orderBy)} ${dir}`;
        }
        else if (filterMode === "sql") {
            // En mode SQL, trier par clé primaire par défaut pour une pagination stable
            try {
                const pkColumn = await this.getPrimaryKeyColumn(tableName);
                orderClause = ` ORDER BY ${this.escapeIdentifier(pkColumn)} ASC`;
            }
            catch {
                // Si pas de clé primaire, pas de tri par défaut
            }
        }

        const pkColumn = await this.getPrimaryKeyColumn(tableName).catch(() => null);
        const selectClause = pkColumn
            ? `${this.escapeIdentifier(pkColumn)} AS rowid, *`
            : "*";

        const dataSql = `SELECT ${selectClause} FROM ${safeTable}${whereClause}${orderClause} LIMIT ? OFFSET ?`;
        const dataResult = await this.query(dataSql, [...whereParams, limit, offset]);

        return {
            records: dataResult.rows as DbRecord[],
            totalCount,
            tableSize: 0,
        };
    }

    public async updateCell(tableName: string, rowid: number, column: string, value: unknown): Promise<void> {
        this.ensureOpen();
        const safeTable = this.escapeIdentifier(tableName);
        const safeColumn = this.escapeIdentifier(column);
        const pkColumn = await this.getPrimaryKeyColumn(tableName);
        await this.execute(`UPDATE ${safeTable} SET ${safeColumn} = ? WHERE ${this.escapeIdentifier(pkColumn)} = ?`, [value, rowid]);
    }

    public async deleteRows(tableName: string, rowids: number[]): Promise<void> {
        this.ensureOpen();
        if (rowids.length === 0) {
            return;
        }
        const safeTable = this.escapeIdentifier(tableName);
        const pkColumn = await this.getPrimaryKeyColumn(tableName);
        const placeholders = rowids.map(() => "?").join(",");
        await this.execute(`DELETE FROM ${safeTable} WHERE ${this.escapeIdentifier(pkColumn)} IN (${placeholders})`, rowids);
    }

    public async getRow(tableName: string, rowid: number): Promise<DbRecord | null> {
        this.ensureOpen();
        const safeTable = this.escapeIdentifier(tableName);
        const pkColumn = await this.getPrimaryKeyColumn(tableName);
        const safePk = this.escapeIdentifier(pkColumn);
        const result = await this.query(`SELECT ${safePk} AS rowid, * FROM ${safeTable} WHERE ${safePk} = ?`, [rowid]);
        return (result.rows[0] as DbRecord) ?? null;
    }

    public async insertRow(tableName: string, values: Record<string, unknown>): Promise<number> {
        this.ensureOpen();
        const safeTable = this.escapeIdentifier(tableName);
        const columns = Object.keys(values);
        const safeColumns = columns.map(c => this.escapeIdentifier(c)).join(", ");
        const placeholders = columns.map(() => "?").join(", ");
        const params = columns.map(c => values[c]);
        const result = await this.execute(`INSERT INTO ${safeTable} (${safeColumns}) VALUES (${placeholders})`, params);
        return result.insertId ?? 0;
    }

    public async batchUpdate(tableName: string, rowids: number[], column: string, value: unknown): Promise<void> {
        this.ensureOpen();
        if (rowids.length === 0) {
            return;
        }
        const safeTable = this.escapeIdentifier(tableName);
        const safeColumn = this.escapeIdentifier(column);
        const pkColumn = await this.getPrimaryKeyColumn(tableName);
        const placeholders = rowids.map(() => "?").join(",");
        await this.execute(
            `UPDATE ${safeTable} SET ${safeColumn} = ? WHERE ${this.escapeIdentifier(pkColumn)} IN (${placeholders})`,
            [value, ...rowids],
        );
    }

    // --- Transactions ---

    public async beginTransaction(): Promise<void> {
        this.ensureOpen();
        if (this._inTransaction) {
            throw new Error("A transaction is already active");
        }
        await this.execute("BEGIN");
        this._inTransaction = true;
    }

    public async commit(): Promise<void> {
        this.ensureOpen();
        if (!this._inTransaction) {
            throw new Error("No active transaction");
        }
        await this.execute("COMMIT");
        this._inTransaction = false;
    }

    public async rollback(): Promise<void> {
        this.ensureOpen();
        if (!this._inTransaction) {
            throw new Error("No active transaction");
        }
        await this.execute("ROLLBACK");
        this._inTransaction = false;
    }

    // --- Export / Import ---

    public async exportData(
        tableName: string,
        format: "json" | "csv" | "xlsx",
        rowids?: number[],
        filter?: string,
    ): Promise<{ data: string; filename: string }> {
        this.ensureOpen();

        const safeTable = this.escapeIdentifier(tableName);
        const pkColumn = await this.getPrimaryKeyColumn(tableName);
        let sql: string;
        let params: unknown[] = [];

        if (rowids && rowids.length > 0) {
            const placeholders = rowids.map(() => "?").join(",");
            sql = `SELECT * FROM ${safeTable} WHERE ${this.escapeIdentifier(pkColumn)} IN (${placeholders})`;
            params = rowids;
        }
        else if (filter && filter.trim().length > 0) {
            sql = `SELECT * FROM ${safeTable} WHERE ${filter}`;
        }
        else {
            sql = `SELECT * FROM ${safeTable}`;
        }

        const result = await this.query(sql, params);
        const records = result.rows as DbRecord[];

        if (format === "json") {
            return { data: JSON.stringify(records, null, 2), filename: `${tableName}.json` };
        }

        if (format === "xlsx") {
            // Chargé à la demande : la bibliothèque est lourde et ne sert qu'à cet export.
            const XLSX = await import("xlsx");
            const worksheet = XLSX.utils.json_to_sheet(records);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, tableName);
            const buffer: Buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
            return { data: buffer.toString("base64"), filename: `${tableName}.xlsx` };
        }

        // CSV
        if (records.length === 0) {
            return { data: "", filename: `${tableName}.csv` };
        }

        const columns = Object.keys(records[0]);
        const header = columns.map(c => this.escapeCsvField(c)).join(",");
        const rows = records.map(r =>
            columns.map(c => this.escapeCsvField(String(r[c] ?? ""))).join(","),
        );

        return { data: [header, ...rows].join("\n"), filename: `${tableName}.csv` };
    }

    public async importData(tableName: string, format: "csv" | "json", data: string, mode: "insert" | "upsert"): Promise<void> {
        this.ensureOpen();

        const records = format === "json" ? this.parseJsonImport(data) : this.parseCsvImport(data);
        if (records.length === 0) {
            return;
        }

        const safeTable = this.escapeIdentifier(tableName);
        const columns = Object.keys(records[0]);
        const safeColumns = columns.map(c => this.escapeIdentifier(c)).join(", ");
        const placeholders = columns.map(() => "?").join(", ");

        const orClause = mode === "upsert" ? " OR REPLACE" : "";

        await this.execute("BEGIN");
        try {
            for (const record of records) {
                const params = columns.map(c => record[c] ?? null);
                await this.execute(`INSERT${orClause} INTO ${safeTable} (${safeColumns}) VALUES (${placeholders})`, params);
            }
            await this.execute("COMMIT");
        }
        catch (err) {
            await this.execute("ROLLBACK");
            throw err;
        }
    }

    public async previewImport(
        tableName: string,
        format: "csv" | "json",
        data: string,
    ): Promise<{ preview: DbRecord[]; totalRows: number; errors: string[] }> {
        this.ensureOpen();

        const errors: string[] = [];

        try {
            const records = format === "json" ? this.parseJsonImport(data) : this.parseCsvImport(data);

            const { fields } = await this.fetchTableSchema(tableName);
            const validColumns = new Set(fields.map(f => f.name));

            for (const col of records.length > 0 ? Object.keys(records[0]) : []) {
                if (!validColumns.has(col)) {
                    errors.push(`Column "${col}" does not exist in table "${tableName}"`);
                }
            }

            return {
                preview: records.slice(0, 20) as DbRecord[],
                totalRows: records.length,
                errors,
            };
        }
        catch (err) {
            return {
                preview: [],
                totalRows: 0,
                errors: [`Parse error: ${err instanceof Error ? err.message : String(err)}`],
            };
        }
    }

    // --- SQL ---

    public async execSql(sql: string): Promise<R_SqlExecResponse> {
        this.ensureOpen();

        let trimmed = sql.trim();
        trimmed = trimmed.endsWith(";") ? trimmed : `${trimmed};`;
        const isSelect = /^SELECT\b/i.test(trimmed);

        const t0 = performance.now();

        try {
            if (isSelect) {
                const result = await this.query(trimmed);
                const executionTimeMs = performance.now() - t0;
                const columns = result.rows.length > 0 ? Object.keys(result.rows[0]) : [];

                return {
                    columns,
                    rows: result.rows.map(r => columns.map(c => r[c])),
                    rowsAffected: 0,
                    isSelect: true,
                    executionTimeMs,
                };
            }
            else {
                const result = await this.execute(trimmed);
                const executionTimeMs = performance.now() - t0;

                return {
                    columns: [],
                    rows: [],
                    rowsAffected: result.affectedRows,
                    lastInsertId: result.insertId || undefined,
                    isSelect: false,
                    executionTimeMs,
                };
            }
        }
        catch (err) {
            throw new Error(`SQL error: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    // --- Index ---

    public async getIndexes(tableName: string): Promise<IndexDef[]> {
        this.ensureOpen();
        return await this.fetchIndexes(tableName);
    }

    public async createIndex(tableName: string, indexName: string, columns: string[], unique: boolean): Promise<void> {
        this.ensureOpen();
        const uniqueClause = unique ? "UNIQUE " : "";
        const safeIndex = this.escapeIdentifier(indexName);
        const safeTable = this.escapeIdentifier(tableName);
        const safeCols = columns.map(c => this.escapeIdentifier(c)).join(", ");
        await this.execute(`CREATE ${uniqueClause}INDEX ${safeIndex} ON ${safeTable} (${safeCols})`);
    }

    public async dropIndex(indexName: string): Promise<void> {
        this.ensureOpen();
        await this.execute(`DROP INDEX ${this.escapeIdentifier(indexName)}`);
    }

    // --- Schéma DDL ---

    public async createTable(name: string, columns: CreateTableColumnDef[], ifNotExists: boolean): Promise<void> {
        this.ensureOpen();

        const safeTable = this.escapeIdentifier(name);
        const ifNotExistsClause = ifNotExists ? "IF NOT EXISTS " : "";

        const pkColumns = columns.filter(c => c.primaryKey);
        const hasSinglePk = pkColumns.length === 1;
        const hasCompositePk = pkColumns.length > 1;

        const colDefs = columns.map(col => {
            const safeName = this.escapeIdentifier(col.name);
            const type = col.type || "TEXT";
            let def = `${safeName} ${type}`;
            if (hasSinglePk && col.primaryKey) {
                def += " PRIMARY KEY";
            }
            if (col.notNull && !col.primaryKey) {
                def += " NOT NULL";
            }
            if (col.unique && !col.primaryKey) {
                def += " UNIQUE";
            }
            if (col.defaultValue !== null && col.defaultValue !== undefined && col.defaultValue !== "") {
                def += ` DEFAULT ${col.defaultValue}`;
            }
            return def;
        });

        if (hasCompositePk) {
            const pkCols = pkColumns.map(c => this.escapeIdentifier(c.name)).join(", ");
            colDefs.push(`PRIMARY KEY (${pkCols})`);
        }

        await this.execute(`CREATE TABLE ${ifNotExistsClause}${safeTable} (${colDefs.join(", ")})`);
    }

    public async alterTable(action: R_AlterTableAction): Promise<void> {
        this.ensureOpen();

        switch (action.action) {
            case "rename-table": {
                const safeOld = this.escapeIdentifier(action.table);
                const safeNew = this.escapeIdentifier(action.newName);
                await this.execute(`ALTER TABLE ${safeOld} RENAME TO ${safeNew}`);
                break;
            }
            case "add-column": {
                const safeTable = this.escapeIdentifier(action.table);
                const safeName = this.escapeIdentifier(action.column.name);
                const type = action.column.type || "TEXT";
                let colDef = `${safeName} ${type}`;
                if (action.column.notNull) {
                    colDef += " NOT NULL";
                }
                if (action.column.defaultValue !== null && action.column.defaultValue !== undefined && action.column.defaultValue !== "") {
                    colDef += ` DEFAULT ${action.column.defaultValue}`;
                }
                await this.execute(`ALTER TABLE ${safeTable} ADD COLUMN ${colDef}`);
                break;
            }
            case "rename-column": {
                const safeTable = this.escapeIdentifier(action.table);
                const safeOldCol = this.escapeIdentifier(action.column);
                const safeNewCol = this.escapeIdentifier(action.newName);
                await this.execute(`ALTER TABLE ${safeTable} RENAME COLUMN ${safeOldCol} TO ${safeNewCol}`);
                break;
            }
            case "drop-column": {
                const safeTable = this.escapeIdentifier(action.table);
                const safeCol = this.escapeIdentifier(action.column);
                await this.execute(`ALTER TABLE ${safeTable} DROP COLUMN ${safeCol}`);
                break;
            }
        }
    }

    public async dropTable(tableName: string): Promise<void> {
        this.ensureOpen();
        await this.execute(`DROP TABLE IF EXISTS ${this.escapeIdentifier(tableName)}`);
    }

    // --- Chiffrement ---

    public async changePassword(_newPassword: string | null): Promise<void> {
        throw new Error(`${this.driverType} does not support client-side encryption`);
    }

    // --- Helpers protégés ---

    protected ensureOpen(): void {
        if (!this._isOpen) {
            throw new Error("Database is not connected");
        }
    }

    /**
     * Récupère le nom de la colonne clé primaire d'une table.
     * Utilisé pour les opérations par rowid (update, delete, get).
     */
    protected abstract getPrimaryKeyColumn(tableName: string): Promise<string>;

    // --- Helpers d'import (partagés) ---

    protected parseJsonImport(data: string): Record<string, unknown>[] {
        const parsed = JSON.parse(data);
        if (!Array.isArray(parsed)) {
            throw new Error("JSON must be an array of objects");
        }
        return parsed as Record<string, unknown>[];
    }

    protected parseCsvImport(data: string): Record<string, unknown>[] {
        const lines = data.split(/\r?\n/).filter(l => l.trim().length > 0);
        if (lines.length < 2) {
            return [];
        }

        const headers = this.parseCsvLine(lines[0]);
        const records: Record<string, unknown>[] = [];

        for (let i = 1; i < lines.length; i++) {
            const values = this.parseCsvLine(lines[i]);
            const record: Record<string, unknown> = {};
            for (let j = 0; j < headers.length; j++) {
                const header = headers[j];
                if (header !== undefined) {
                    record[header] = values[j] !== undefined ? this.parseCsvValue(values[j]) : null;
                }
            }
            records.push(record);
        }

        return records;
    }

    private parseCsvLine(line: string): string[] {
        const fields: string[] = [];
        let current = "";
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
                    current += '"';
                    i++;
                }
                else {
                    inQuotes = !inQuotes;
                }
            }
            else if (char === "," && !inQuotes) {
                fields.push(current);
                current = "";
            }
            else {
                current += char;
            }
        }

        fields.push(current);
        return fields;
    }

    private parseCsvValue(value: string): unknown {
        if (value === "" || value.toLowerCase() === "null") {
            return null;
        }
        if (value.toLowerCase() === "true") {
            return 1;
        }
        if (value.toLowerCase() === "false") {
            return 0;
        }
        const num = Number(value);
        if (!Number.isNaN(num) && value.trim() !== "") {
            return num;
        }
        return value;
    }

    protected escapeCsvField(field: string): string {
        if (field.includes(",") || field.includes('"') || field.includes("\n")) {
            return `"${field.replace(/"/g, '""')}"`;
        }
        return field;
    }
}
