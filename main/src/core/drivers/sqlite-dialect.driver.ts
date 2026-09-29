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
import type {
    DatabaseCategory,
    DatabaseDriverType,
    DriverCapabilities,
    DriverConnectionOptions,
    DriverInfo,
} from "@shared/driver";
import type { DatabaseDriver } from "src/core/drivers/driver.interface";
import { getDriverInfo } from "src/core/drivers/driver-registry";
import type { SqliteImportPlan, SqliteRunResult, SqliteStatement } from "src/core/drivers/sqlite-dialect.types";

interface ColumnInfo {
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
}

interface ForeignKeyInfo {
    from: string;
    table: string;
    to: string;
}

const FILTER_OPERATORS = new Set(["=", "!=", "<>", "<", ">", "<=", ">=", "(", ")", ",", "+", "-", "*", "/", "%"]);

const FILTER_KEYWORDS = new Set([
    "and", "or", "not", "like", "in", "is", "null",
    "between", "glob", "escape", "exists",
    "case", "when", "then", "else", "end",
    "true", "false",
]);

const FILTER_FUNCTIONS = new Set([
    "count", "sum", "avg", "min", "max",
    "length", "upper", "lower", "trim", "ltrim", "rtrim",
    "substr", "replace", "instr", "typeof", "abs", "round",
    "coalesce", "ifnull", "nullif", "iif",
    "date", "time", "datetime", "strftime",
    "hex", "quote", "zeroblob",
]);

/**
 * Socle des drivers qui parlent le dialecte SQLite : fichier local
 * (`SqliteDriver`, better-sqlite3) et base distante (`LibsqlDriver`, libSQL / Turso).
 *
 * Tout ce qui ne dépend que du SQL (schéma par `PRAGMA`, pagination sur `_rowid_`,
 * filtres, CRUD, DDL, index, export) est écrit une fois ici, au-dessus de deux
 * primitives asynchrones (`queryAll`, `run`). Chaque driver n'implémente que son
 * transport, son cycle de vie et ce que son client fait mieux (lecture en flux,
 * lot atomique, chiffrement).
 */
export abstract class SqliteDialectDriver implements DatabaseDriver {
    public abstract readonly driverType: DatabaseDriverType;
    public readonly category: DatabaseCategory = "sql";

    protected inTransaction = false;

    /** `dbstat` est absent de certaines compilations (et des serveurs libSQL) : on ne le réessaie pas à chaque page. */
    private dbstatAvailable = true;

    public get info(): DriverInfo {
        return getDriverInfo(this.driverType);
    }

    public get capabilities(): DriverCapabilities {
        return this.info.capabilities;
    }

    public get isInTransaction(): boolean {
        return this.inTransaction;
    }

    public abstract get isOpen(): boolean;
    public abstract get path(): string | null;

    // --- Transport (implémenté par chaque driver) ---

    /** Nom affiché de la base (nom du fichier, hôte distant). */
    protected abstract get databaseName(): string;

    /** Exécute une lecture et retourne ses lignes sous forme d'objets. */
    protected abstract queryAll(sql: string, params?: unknown[]): Promise<DbRecord[]>;

    /** Exécute une écriture. */
    protected abstract run(sql: string, params?: unknown[]): Promise<SqliteRunResult>;

    public abstract open(location: string): Promise<boolean>;
    public abstract unlock(password: string): Promise<void>;
    public abstract close(): Promise<void>;
    public abstract execSql(sql: string, maxRows?: number): Promise<R_SqlExecResponse>;
    public abstract importData(tableName: string, format: "csv" | "json", data: string, mode: "insert" | "upsert"): Promise<void>;
    public abstract changePassword(newPassword: string | null): Promise<void>;

    /**
     * Enchaîne plusieurs lectures. Un driver distant les regroupe en un seul
     * aller-retour : la lecture du schéma en émet trois par table.
     */
    protected async queryBatch(statements: SqliteStatement[]): Promise<DbRecord[][]> {
        const results: DbRecord[][] = [];

        for (const statement of statements) {
            results.push(await this.queryAll(statement.sql, statement.params));
        }

        return results;
    }

    /** Taille de stockage de la base, en octets (0 si inconnue). */
    protected getStorageSize(): number {
        return 0;
    }

    /** Aucune option n'est utile par défaut ; `LibsqlDriver` lit le jeton et le délai. */
    public async configureConnection(_options: DriverConnectionOptions): Promise<void> {
        // Rien à configurer pour un fichier local.
    }

    // --- Schéma ---

    public async getSchema(): Promise<DatabaseSchema> {
        this.ensureOpen();

        const tables = await this.queryAll(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        );
        const names = tables.map(table => String(table["name"]));
        const statements = names.flatMap(name => {
            const safeName = this.escapeIdentifier(name);

            return [
                { sql: `PRAGMA table_info(${safeName})` },
                { sql: `PRAGMA foreign_key_list(${safeName})` },
                { sql: `SELECT count(*) AS cnt FROM ${safeName}` },
            ];
        });
        const results = await this.queryBatch(statements);
        const weight = this.getStorageSize();

        const tableSchemas: TableSchema[] = names.map((name, index) => {
            const offset = index * 3;
            const columns = (results[offset] ?? []) as unknown as ColumnInfo[];
            const foreignKeys = (results[offset + 1] ?? []) as unknown as ForeignKeyInfo[];
            const recordCount = Number(results[offset + 2]?.[0]?.["cnt"] ?? 0);

            return { name, fields: this.toFields(columns, foreignKeys), weight, recordCount };
        });

        return {
            name: this.databaseName,
            path: this.path ?? "",
            tables: tableSchemas,
            driverType: this.driverType,
        };
    }

    public async getTablesSql(): Promise<{ name: string; sql: string }[]> {
        this.ensureOpen();

        const rows = await this.queryAll(
            "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY name",
        );

        return rows.map(row => ({ name: String(row["name"]), sql: String(row["sql"]) }));
    }

    // --- Données ---

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
                const { whereClause: sqlWhere, orderClause: sqlOrder } = this.extractOrderByFromFilter(filter);
                filterOrderClause = sqlOrder;

                // Un filtre réduit à un ORDER BY ne produit pas de clause WHERE.
                if (sqlWhere.trim().length > 0) {
                    try {
                        const clause = this.parseFilter(sqlWhere, await this.tableColumnNames(tableName));
                        // `LIMIT 0` fait valider l'expression par le moteur sans rien lire.
                        await this.queryAll(`SELECT 1 FROM ${safeTable} WHERE ${clause} LIMIT 0`);
                        whereClause = ` WHERE ${clause}`;
                    }
                    catch {
                        return { records: [], totalCount: 0, tableSize: 0 };
                    }
                }
            }
            else {
                const columns = await this.tableColumnNames(tableName);
                const conditions = columns.map(column => `CAST(${this.escapeIdentifier(column)} AS TEXT) LIKE ?`);
                const likeParam = `%${filter.trim()}%`;

                whereClause = ` WHERE (${conditions.join(" OR ")})`;
                whereParams.push(...columns.map(() => likeParam));
            }
        }

        let orderClause = "";

        if (filterOrderClause) {
            orderClause = ` ${filterOrderClause}`;
        }
        else if (orderBy) {
            const direction = orderDir === "DESC" ? "DESC" : "ASC";
            orderClause = ` ORDER BY ${this.escapeIdentifier(orderBy)} ${direction}`;
        }
        else if (filterMode === "sql") {
            // En mode SQL, trier par rowid par défaut pour une pagination stable.
            orderClause = " ORDER BY _rowid_ ASC";
        }

        // '_rowid_ AS rowid' force SQLite à créer une nouvelle colonne nommée 'rowid',
        // distincte de toute colonne user (y compris INTEGER PRIMARY KEY qui aliase le rowid).
        // Avec 'SELECT *, rowid', SQLite déduplique 'rowid' si 'id' est INTEGER PRIMARY KEY.
        const [countRows, records] = await this.queryBatch([
            { sql: `SELECT count(*) AS cnt FROM ${safeTable}${whereClause}`, params: whereParams },
            {
                sql: `SELECT *, _rowid_ AS rowid FROM ${safeTable}${whereClause}${orderClause} LIMIT ? OFFSET ?`,
                params: [...whereParams, limit, offset],
            },
        ]);

        return {
            records: records ?? [],
            totalCount: Number(countRows?.[0]?.["cnt"] ?? 0),
            tableSize: await this.readTableSize(tableName),
        };
    }

    public async updateCell(tableName: string, rowid: number, column: string, value: unknown): Promise<void> {
        this.ensureOpen();

        const safeTable = this.escapeIdentifier(tableName);
        const safeColumn = this.escapeIdentifier(column);

        await this.run(`UPDATE ${safeTable} SET ${safeColumn} = ? WHERE _rowid_ = ?`, [value, rowid]);
    }

    public async deleteRows(tableName: string, rowids: number[]): Promise<void> {
        this.ensureOpen();

        if (rowids.length === 0) {
            return;
        }

        const placeholders = rowids.map(() => "?").join(",");

        await this.run(`DELETE FROM ${this.escapeIdentifier(tableName)} WHERE _rowid_ IN (${placeholders})`, rowids);
    }

    public async truncateTable(tableName: string): Promise<number> {
        this.ensureOpen();

        const result = await this.run(`DELETE FROM ${this.escapeIdentifier(tableName)}`);

        return result.changes;
    }

    public async getRow(tableName: string, rowid: number): Promise<DbRecord | null> {
        this.ensureOpen();

        // Idem : _rowid_ AS rowid pour garantir la clé 'rowid' même sur INTEGER PRIMARY KEY.
        const rows = await this.queryAll(
            `SELECT *, _rowid_ AS rowid FROM ${this.escapeIdentifier(tableName)} WHERE _rowid_ = ?`,
            [rowid],
        );

        return rows[0] ?? null;
    }

    public async insertRow(tableName: string, values: Record<string, unknown>): Promise<number> {
        this.ensureOpen();

        const columns = Object.keys(values);
        const safeColumns = columns.map(column => this.escapeIdentifier(column)).join(", ");
        const placeholders = columns.map(() => "?").join(", ");
        const params = columns.map(column => values[column]);

        const result = await this.run(
            `INSERT INTO ${this.escapeIdentifier(tableName)} (${safeColumns}) VALUES (${placeholders})`,
            params,
        );

        return result.lastInsertRowid;
    }

    public async batchUpdate(tableName: string, rowids: number[], column: string, value: unknown): Promise<void> {
        this.ensureOpen();

        if (rowids.length === 0) {
            return;
        }

        const safeTable = this.escapeIdentifier(tableName);
        const safeColumn = this.escapeIdentifier(column);
        const placeholders = rowids.map(() => "?").join(",");

        await this.run(`UPDATE ${safeTable} SET ${safeColumn} = ? WHERE _rowid_ IN (${placeholders})`, [value, ...rowids]);
    }

    // --- Transactions ---

    public async beginTransaction(): Promise<void> {
        this.ensureOpen();

        if (this.inTransaction) {
            throw new Error("A transaction is already active");
        }

        await this.run("BEGIN TRANSACTION");
        this.inTransaction = true;
    }

    public async commit(): Promise<void> {
        this.ensureOpen();

        if (!this.inTransaction) {
            throw new Error("No active transaction");
        }

        await this.run("COMMIT");
        this.inTransaction = false;
    }

    public async rollback(): Promise<void> {
        this.ensureOpen();

        if (!this.inTransaction) {
            throw new Error("No active transaction");
        }

        await this.run("ROLLBACK");
        this.inTransaction = false;
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
        let records: DbRecord[];

        if (rowids && rowids.length > 0) {
            const placeholders = rowids.map(() => "?").join(",");
            records = await this.queryAll(`SELECT * FROM ${safeTable} WHERE _rowid_ IN (${placeholders})`, rowids);
        }
        else if (filter && filter.trim().length > 0) {
            const whereClause = this.parseFilter(filter, await this.tableColumnNames(tableName));
            records = await this.queryAll(`SELECT * FROM ${safeTable} WHERE ${whereClause}`);
        }
        else {
            records = await this.queryAll(`SELECT * FROM ${safeTable}`);
        }

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

        const filename = `${tableName}.csv`;
        const [first] = records;

        if (!first) {
            return { data: "", filename };
        }

        const columns = Object.keys(first);
        const header = columns.map(column => this.escapeCsvField(column)).join(",");
        const rows = records.map(record =>
            columns.map(column => this.escapeCsvField(String(record[column] ?? ""))).join(","),
        );

        return { data: [header, ...rows].join("\n"), filename };
    }

    public async previewImport(
        tableName: string,
        format: "csv" | "json",
        data: string,
    ): Promise<{ preview: DbRecord[]; totalRows: number; errors: string[] }> {
        this.ensureOpen();

        const errors: string[] = [];

        try {
            const records = this.parseImport(format, data);
            const validColumns = new Set(await this.tableColumnNames(tableName));
            const importedColumns = records.length > 0 ? Object.keys(records[0] ?? {}) : [];

            for (const column of importedColumns) {
                if (!validColumns.has(column)) {
                    errors.push(`Column "${column}" does not exist in table "${tableName}"`);
                }
            }

            return { preview: records.slice(0, 20) as DbRecord[], totalRows: records.length, errors };
        }
        catch (err) {
            return {
                preview: [],
                totalRows: 0,
                errors: [`Parse error: ${err instanceof Error ? err.message : String(err)}`],
            };
        }
    }

    /**
     * Prépare l'insertion d'un import : une seule instruction, et les valeurs de
     * chaque ligne dans l'ordre des colonnes de la première.
     * @returns `null` si les données ne contiennent aucune ligne.
     */
    protected prepareImport(tableName: string, format: "csv" | "json", data: string, mode: "insert" | "upsert"): SqliteImportPlan | null {
        const records = this.parseImport(format, data);
        const [first] = records;

        if (!first) {
            return null;
        }

        const columns = Object.keys(first);
        const safeColumns = columns.map(column => this.escapeIdentifier(column)).join(", ");
        const placeholders = columns.map(() => "?").join(", ");
        const orClause = mode === "upsert" ? " OR REPLACE" : "";

        return {
            sql: `INSERT${orClause} INTO ${this.escapeIdentifier(tableName)} (${safeColumns}) VALUES (${placeholders})`,
            rows: records.map(record => columns.map(column => record[column] ?? null)),
        };
    }

    // --- Index ---

    public async getIndexes(tableName: string): Promise<IndexDef[]> {
        this.ensureOpen();

        const rawIndexes = await this.queryAll(`PRAGMA index_list(${this.escapeIdentifier(tableName)})`);
        const details = await this.queryBatch(
            rawIndexes.map(index => ({ sql: `PRAGMA index_info(${this.escapeIdentifier(String(index["name"]))})` })),
        );

        return rawIndexes.map((index, position) => ({
            name: String(index["name"]),
            table: tableName,
            unique: Number(index["unique"]) === 1,
            columns: (details[position] ?? []).map(column => String(column["name"])),
            origin: String(index["origin"]),
        }));
    }

    public async createIndex(tableName: string, indexName: string, columns: string[], unique: boolean): Promise<void> {
        this.ensureOpen();

        const uniqueClause = unique ? "UNIQUE " : "";
        const safeIndex = this.escapeIdentifier(indexName);
        const safeTable = this.escapeIdentifier(tableName);
        const safeColumns = columns.map(column => this.escapeIdentifier(column)).join(", ");

        await this.run(`CREATE ${uniqueClause}INDEX IF NOT EXISTS ${safeIndex} ON ${safeTable} (${safeColumns})`);
    }

    public async dropIndex(indexName: string): Promise<void> {
        this.ensureOpen();

        await this.run(`DROP INDEX IF EXISTS ${this.escapeIdentifier(indexName)}`);
    }

    // --- Schéma ---

    public async createTable(name: string, columns: CreateTableColumnDef[], ifNotExists: boolean): Promise<void> {
        this.ensureOpen();

        const safeTable = this.escapeIdentifier(name);
        const ifNotExistsClause = ifNotExists ? "IF NOT EXISTS " : "";

        const pkColumns = columns.filter(column => column.primaryKey);
        const hasSinglePk = pkColumns.length === 1;
        const hasCompositePk = pkColumns.length > 1;

        const columnDefinitions = columns.map(column => {
            let definition = `${this.escapeIdentifier(column.name)} ${column.type || "TEXT"}`;

            if (hasSinglePk && column.primaryKey) {
                definition += " PRIMARY KEY";
            }

            if (column.notNull && !column.primaryKey) {
                definition += " NOT NULL";
            }

            if (column.unique && !column.primaryKey) {
                definition += " UNIQUE";
            }

            if (column.defaultValue !== null && column.defaultValue !== undefined && column.defaultValue !== "") {
                definition += ` DEFAULT ${column.defaultValue}`;
            }

            return definition;
        });

        if (hasCompositePk) {
            const pkList = pkColumns.map(column => this.escapeIdentifier(column.name)).join(", ");
            columnDefinitions.push(`PRIMARY KEY (${pkList})`);
        }

        await this.run(`CREATE TABLE ${ifNotExistsClause}${safeTable} (${columnDefinitions.join(", ")})`);
    }

    public async alterTable(action: R_AlterTableAction): Promise<void> {
        this.ensureOpen();

        const safeTable = this.escapeIdentifier(action.table);

        switch (action.action) {
            case "rename-table":
                await this.run(`ALTER TABLE ${safeTable} RENAME TO ${this.escapeIdentifier(action.newName)}`);
                break;

            case "add-column": {
                let columnDefinition = `${this.escapeIdentifier(action.column.name)} ${action.column.type || "TEXT"}`;
                const defaultValue = action.column.defaultValue;

                if (action.column.notNull) {
                    columnDefinition += " NOT NULL";
                }

                if (defaultValue !== null && defaultValue !== undefined && defaultValue !== "") {
                    columnDefinition += ` DEFAULT ${defaultValue}`;
                }

                await this.run(`ALTER TABLE ${safeTable} ADD COLUMN ${columnDefinition}`);
                break;
            }

            case "rename-column": {
                const safeOld = this.escapeIdentifier(action.column);
                const safeNew = this.escapeIdentifier(action.newName);
                await this.run(`ALTER TABLE ${safeTable} RENAME COLUMN ${safeOld} TO ${safeNew}`);
                break;
            }

            case "drop-column":
                await this.run(`ALTER TABLE ${safeTable} DROP COLUMN ${this.escapeIdentifier(action.column)}`);
                break;
        }
    }

    public async dropTable(tableName: string): Promise<void> {
        this.ensureOpen();

        await this.run(`DROP TABLE IF EXISTS ${this.escapeIdentifier(tableName)}`);
    }

    // --- Helpers ---

    protected ensureOpen(): void {
        if (!this.isOpen) {
            throw new Error("Database is not open");
        }
    }

    protected escapeIdentifier(name: string): string {
        return `"${name.replace(/"/g, '""')}"`;
    }

    /** Détecte une instruction qui produit des lignes (lecture) plutôt qu'un effet. */
    protected isReadStatement(sql: string): boolean {
        return /^SELECT\b/i.test(sql.trim());
    }

    private toFields(columns: ColumnInfo[], foreignKeys: ForeignKeyInfo[]): FieldDef[] {
        const fkMap = new Map<string, ForeignKeyDef>();

        for (const fk of foreignKeys) {
            fkMap.set(fk.from, { table: fk.table, column: fk.to });
        }

        return columns.map(column => ({
            name: column.name,
            type: column.type,
            notnull: Number(column.notnull) === 1,
            dflt_value: column.dflt_value,
            pk: Number(column.pk) > 0,
            fk: fkMap.get(column.name) ?? null,
        }));
    }

    private async tableColumnNames(tableName: string): Promise<string[]> {
        const columns = await this.queryAll(`PRAGMA table_info(${this.escapeIdentifier(tableName)})`);

        return columns.map(column => String(column["name"]));
    }

    private async readTableSize(tableName: string): Promise<number> {
        if (!this.dbstatAvailable) {
            return 0;
        }

        try {
            const rows = await this.queryAll("SELECT SUM(pgsize) AS sz FROM dbstat WHERE name = ?", [tableName]);
            return Number(rows[0]?.["sz"] ?? 0);
        }
        catch {
            this.dbstatAvailable = false;
            return 0;
        }
    }

    private parseImport(format: "csv" | "json", data: string): Record<string, unknown>[] {
        return format === "json" ? this.parseJsonImport(data) : this.parseCsvImport(data);
    }

    private parseJsonImport(data: string): Record<string, unknown>[] {
        const parsed = JSON.parse(data);

        if (!Array.isArray(parsed)) {
            throw new Error("JSON must be an array of objects");
        }

        return parsed as Record<string, unknown>[];
    }

    private parseCsvImport(data: string): Record<string, unknown>[] {
        const lines = data.split(/\r?\n/).filter(line => line.trim().length > 0);
        const [headerLine, ...dataLines] = lines;

        if (headerLine === undefined || dataLines.length === 0) {
            return [];
        }

        const headers = this.parseCsvLine(headerLine);

        return dataLines.map(line => {
            const values = this.parseCsvLine(line);
            const record: Record<string, unknown> = {};

            headers.forEach((header, index) => {
                const value = values[index];
                record[header] = value !== undefined ? this.parseCsvValue(value) : null;
            });

            return record;
        });
    }

    private parseCsvLine(line: string): string[] {
        const fields: string[] = [];
        let current = "";
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
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
        const lower = value.toLowerCase();

        if (value === "" || lower === "null") {
            return null;
        }

        if (lower === "true") {
            return 1;
        }

        if (lower === "false") {
            return 0;
        }

        const num = Number(value);

        if (!Number.isNaN(num) && value.trim() !== "") {
            return num;
        }

        return value;
    }

    private escapeCsvField(field: string): string {
        if (field.includes(",") || field.includes('"') || field.includes("\n")) {
            return `"${field.replace(/"/g, '""')}"`;
        }

        return field;
    }

    /**
     * Extrait la clause ORDER BY du filtre SQL s'il existe.
     * Retourne { whereClause, orderClause } où orderClause est vide ou commence par "ORDER BY".
     */
    private extractOrderByFromFilter(filter: string): { whereClause: string; orderClause: string } {
        const trimmed = filter.trim();

        if (/^\s*ORDER\s+BY\s+/i.test(trimmed)) {
            return { whereClause: "", orderClause: trimmed };
        }

        const match = /^(?<where>[\s\S]*?)\s+(?<order>ORDER\s+BY\s+[\s\S]+)$/i.exec(trimmed);
        const groups = match?.groups;

        if (!groups) {
            return { whereClause: trimmed, orderClause: "" };
        }

        return { whereClause: (groups["where"] ?? "").trim(), orderClause: groups["order"] ?? "" };
    }

    /**
     * Réécrit un filtre saisi en clause WHERE sûre : seuls les opérateurs, mots-clés,
     * fonctions, littéraux et colonnes connus de la table sont acceptés.
     */
    private parseFilter(filter: string, columnNames: string[]): string {
        const validColumns = new Set(columnNames.map(name => name.toLowerCase()));
        const tokens = this.tokenize(filter);
        const safeParts: string[] = [];

        tokens.forEach((token, index) => {
            const lower = token.toLowerCase();

            if (FILTER_OPERATORS.has(token)) {
                safeParts.push(token);
            }
            else if (FILTER_KEYWORDS.has(lower)) {
                safeParts.push(token.toUpperCase());
            }
            else if (FILTER_FUNCTIONS.has(lower) && tokens[index + 1] === "(") {
                safeParts.push(lower.toUpperCase());
            }
            else if (/^'.*'$/.test(token) || /^-?\d+(\.\d+)?$/.test(token)) {
                safeParts.push(token);
            }
            else if (validColumns.has(lower)) {
                safeParts.push(this.escapeIdentifier(token));
            }
            else if (/^".*"$/.test(token) && validColumns.has(token.slice(1, -1).replace(/""/g, '"').toLowerCase())) {
                safeParts.push(this.escapeIdentifier(token.slice(1, -1).replace(/""/g, '"')));
            }
            else {
                throw new Error(`Invalid filter token: '${token}'`);
            }
        });

        const result = safeParts.join(" ");

        if (result.trim().length === 0) {
            throw new Error("Empty filter expression");
        }

        return result;
    }

    /**
     * Tokenise une expression de filtre.
     */
    private tokenize(input: string): string[] {
        const tokens: string[] = [];
        let i = 0;

        while (i < input.length) {
            const char = input[i] ?? "";

            if (/\s/.test(char)) {
                i++;
                continue;
            }

            if (char === "'" || char === '"') {
                const end = this.findClosingQuote(input, i, char);
                tokens.push(input.slice(i, end + 1));
                i = end + 1;
                continue;
            }

            const twoChars = input.slice(i, i + 2);

            if (["!=", "<>", "<=", ">="].includes(twoChars)) {
                tokens.push(twoChars);
                i += 2;
                continue;
            }

            if ("=<>(),+-*/%".includes(char)) {
                tokens.push(char);
                i++;
                continue;
            }

            if (/\d/.test(char)) {
                let j = i;

                while (j < input.length && /[\d.]/.test(input[j] ?? "")) {
                    j++;
                }

                tokens.push(input.slice(i, j));
                i = j;
                continue;
            }

            if (/[a-zA-Z_]/.test(char)) {
                let j = i;

                while (j < input.length && /[a-zA-Z0-9_]/.test(input[j] ?? "")) {
                    j++;
                }

                tokens.push(input.slice(i, j));
                i = j;
                continue;
            }

            throw new Error(`Unexpected character in filter: '${char}'`);
        }

        return tokens;
    }

    /**
     * Position du guillemet fermant d'un littéral ou d'un identifiant, un
     * guillemet doublé valant un guillemet échappé.
     */
    private findClosingQuote(input: string, start: number, quote: string): number {
        let j = start + 1;

        while (j < input.length) {
            if (input[j] !== quote) {
                j++;
            }
            else if (input[j + 1] === quote) {
                j += 2;
            }
            else {
                break;
            }
        }

        return j;
    }
}
