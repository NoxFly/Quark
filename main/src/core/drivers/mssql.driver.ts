/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import type { DatabaseDriverType } from "@shared/driver";
import type { DbRecord, FieldDef, ForeignKeyDef, IndexDef } from "@shared/types";
import { NetworkSqlDriver, type RawQueryResult } from "src/core/drivers/network-sql.driver";
import { Connection, Request as TdsRequest, TYPES } from "tedious";

/**
 * Driver SQL Server (MSSQL) utilisant tedious.
 * Se connecte via une URI `user:password@host:port/database`.
 */
export class MssqlDriver extends NetworkSqlDriver {
    public readonly driverType: DatabaseDriverType = "mssql";
    private connection: Connection | null = null;

    protected connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            const p = this.connectionParams!;

            const config = {
                server: p.host,
                authentication: {
                    type: "default" as const,
                    options: {
                        userName: p.user,
                        password: p.password,
                    },
                },
                options: {
                    database: p.database,
                    port: p.port,
                    encrypt: false,
                    trustServerCertificate: true,
                    rowCollectionOnRequestCompletion: true,
                },
            };

            this.connection = new Connection(config);
            this.connection.on("connect", (err) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve();
                }
            });

            this.connection.connect();
        });
    }

    protected disconnect(): Promise<void> {
        return new Promise((resolve) => {
            if (this.connection) {
                this.connection.on("end", () => resolve());
                this.connection.close();
                this.connection = null;
            }
            else {
                resolve();
            }
        });
    }

    protected query(sql: string, params: unknown[] = []): Promise<RawQueryResult> {
        return new Promise((resolve, reject) => {
            const rows: Record<string, unknown>[] = [];

            const request = new TdsRequest(sql, (err, _rowCount) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve({ rows, affectedRows: 0 });
                }
            });

            this.addParams(request, params);

            request.on("row", (columns: { metadata: { colName: string }; value: unknown }[]) => {
                const row: Record<string, unknown> = {};
                for (const col of columns) {
                    row[col.metadata.colName] = col.value;
                }
                rows.push(row);
            });

            this.connection!.execSql(request);
        });
    }

    protected execute(sql: string, params: unknown[] = []): Promise<{ affectedRows: number; insertId?: number }> {
        return new Promise((resolve, reject) => {
            const request = new TdsRequest(sql, (err, rowCount) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve({ affectedRows: rowCount ?? 0 });
                }
            });

            this.addParams(request, params);
            this.connection!.execSql(request);
        });
    }

    /**
     * Ajoute les paramètres positionnels au TdsRequest.
     * Tedious utilise des paramètres nommés, on les mappe depuis la position.
     */
    private addParams(request: TdsRequest, params: unknown[]): void {
        for (let i = 0; i < params.length; i++) {
            const value = params[i];
            const name = `p${i}`;
            const type = this.inferTdsType(value);
            request.addParameter(name, type, value);
        }
    }

    /**
     * Infère le type tedious à partir d'une valeur JavaScript.
     */
    private inferTdsType(value: unknown): typeof TYPES[keyof typeof TYPES] {
        if (value === null || value === undefined) {
            return TYPES.NVarChar;
        }
        if (typeof value === "number") {
            return Number.isInteger(value) ? TYPES.BigInt : TYPES.Float;
        }
        if (typeof value === "boolean") {
            return TYPES.Bit;
        }
        if (value instanceof Date) {
            return TYPES.DateTime;
        }
        if (Buffer.isBuffer(value)) {
            return TYPES.VarBinary;
        }
        return TYPES.NVarChar;
    }

    /**
     * Override pour convertir les ? en @p0, @p1, ... (paramètres nommés MSSQL).
     */
    public override async getTableData(
        tableName: string,
        offset: number,
        limit: number,
        orderBy?: string,
        orderDir?: "ASC" | "DESC",
        filter?: string,
        filterMode: "sqlite" | "fulltext" = "fulltext",
    ): Promise<{ records: DbRecord[]; totalCount: number; tableSize: number }> {
        this.ensureOpen();

        const safeTable = this.escapeIdentifier(tableName);
        let whereClause = "";
        const whereParams: unknown[] = [];

        if (filter && filter.trim().length > 0) {
            if (filterMode === "sqlite") {
                whereClause = ` WHERE ${filter}`;
            }
            else {
                const { fields } = await this.fetchTableSchema(tableName);
                const conditions = fields.map((f, i) =>
                    `CAST(${this.escapeIdentifier(f.name)} AS NVARCHAR(MAX)) LIKE @p${i}`,
                );
                const likeParam = `%${filter.trim()}%`;
                for (const _f of fields) {
                    whereParams.push(likeParam);
                }
                whereClause = ` WHERE (${conditions.join(" OR ")})`;
            }
        }

        // COUNT
        const countSql = `SELECT COUNT(*) AS cnt FROM ${safeTable}${whereClause}`;
        const countResult = await this.query(
            this.replacePositionalParams(countSql, whereParams.length),
            whereParams,
        );
        const totalCount = Number(countResult.rows[0]?.["cnt"] ?? 0);

        // Données — MSSQL nécessite ORDER BY pour OFFSET FETCH
        let orderClause = "";
        if (orderBy) {
            const dir = orderDir === "DESC" ? "DESC" : "ASC";
            orderClause = ` ORDER BY ${this.escapeIdentifier(orderBy)} ${dir}`;
        }
        else {
            // Fallback: ORDER BY la première colonne PK
            try {
                const pk = await this.getPrimaryKeyColumn(tableName);
                orderClause = ` ORDER BY ${this.escapeIdentifier(pk)} ASC`;
            }
            catch {
                orderClause = " ORDER BY (SELECT NULL)";
            }
        }

        const paramCount = whereParams.length;
        const dataSql = `SELECT * FROM ${safeTable}${whereClause}${orderClause} OFFSET @p${paramCount} ROWS FETCH NEXT @p${paramCount + 1} ROWS ONLY`;

        const dataResult = await this.query(dataSql, [...whereParams, offset, limit]);

        return {
            records: dataResult.rows as DbRecord[],
            totalCount,
            tableSize: 0,
        };
    }

    /**
     * Remplace les ? SQL par @p0, @p1, etc.
     */
    private replacePositionalParams(sql: string, startFrom = 0): string {
        let idx = startFrom;
        return sql.replace(/\?/g, () => {
            const param = `@p${idx}`;
            idx++;
            return param;
        });
    }

    protected async fetchTables(): Promise<string[]> {
        const result = await this.query(
            "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_SCHEMA = 'dbo' ORDER BY TABLE_NAME",
        );
        return result.rows.map(row => String(row["TABLE_NAME"]));
    }

    protected async fetchTableSchema(tableName: string): Promise<{ fields: FieldDef[]; recordCount: number }> {
        const columnsResult = await this.query(
            `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_NAME = @p0 AND TABLE_SCHEMA = 'dbo'
             ORDER BY ORDINAL_POSITION`,
            [tableName],
        );

        // Récupérer les PK
        const pkResult = await this.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
             WHERE OBJECTPROPERTY(OBJECT_ID(CONSTRAINT_NAME), 'IsPrimaryKey') = 1
             AND TABLE_NAME = @p0 AND TABLE_SCHEMA = 'dbo'`,
            [tableName],
        );
        const pkColumns = new Set(pkResult.rows.map(r => String(r["COLUMN_NAME"])));

        const fkMap = await this.fetchForeignKeys(tableName);

        const fields: FieldDef[] = columnsResult.rows.map(col => ({
            name: String(col["COLUMN_NAME"]),
            type: String(col["DATA_TYPE"]).toUpperCase(),
            notnull: col["IS_NULLABLE"] === "NO",
            dflt_value: col["COLUMN_DEFAULT"] !== null ? String(col["COLUMN_DEFAULT"]) : null,
            pk: pkColumns.has(String(col["COLUMN_NAME"])),
            fk: fkMap.get(String(col["COLUMN_NAME"])) ?? null,
        }));

        const countResult = await this.query(
            `SELECT COUNT(*) AS cnt FROM ${this.escapeIdentifier(tableName)}`,
        );
        const recordCount = Number(countResult.rows[0]?.["cnt"] ?? 0);

        return { fields, recordCount };
    }

    protected async fetchForeignKeys(tableName: string): Promise<Map<string, ForeignKeyDef>> {
        const result = await this.query(
            `SELECT
                ccu.COLUMN_NAME,
                kcu2.TABLE_NAME AS REFERENCED_TABLE_NAME,
                kcu2.COLUMN_NAME AS REFERENCED_COLUMN_NAME
             FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
             JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ccu
                ON rc.CONSTRAINT_NAME = ccu.CONSTRAINT_NAME
             JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu2
                ON rc.UNIQUE_CONSTRAINT_NAME = kcu2.CONSTRAINT_NAME
             WHERE ccu.TABLE_NAME = @p0 AND ccu.TABLE_SCHEMA = 'dbo'`,
            [tableName],
        );

        const fkMap = new Map<string, ForeignKeyDef>();
        for (const row of result.rows) {
            fkMap.set(String(row["COLUMN_NAME"]), {
                table: String(row["REFERENCED_TABLE_NAME"]),
                column: String(row["REFERENCED_COLUMN_NAME"]),
            });
        }
        return fkMap;
    }

    protected escapeIdentifier(name: string): string {
        return `[${name.replace(/\]/g, "]]")}]`;
    }

    protected async fetchTablesSql(): Promise<{ name: string; sql: string }[]> {
        const tables = await this.fetchTables();
        const results: { name: string; sql: string }[] = [];

        for (const table of tables) {
            const { fields } = await this.fetchTableSchema(table);
            const colDefs = fields.map(f => {
                let def = `${this.escapeIdentifier(f.name)} ${f.type}`;
                if (f.pk) {
                    def += " PRIMARY KEY";
                }
                if (f.notnull && !f.pk) {
                    def += " NOT NULL";
                }
                if (f.dflt_value !== null) {
                    def += ` DEFAULT ${f.dflt_value}`;
                }
                return def;
            });
            results.push({ name: table, sql: `CREATE TABLE ${this.escapeIdentifier(table)} (${colDefs.join(", ")})` });
        }

        return results;
    }

    protected async fetchIndexes(tableName: string): Promise<IndexDef[]> {
        const result = await this.query(
            `SELECT i.name AS index_name, i.is_unique, c.name AS column_name
             FROM sys.indexes i
             JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
             JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
             WHERE i.object_id = OBJECT_ID(@p0) AND i.name IS NOT NULL
             ORDER BY i.name, ic.key_ordinal`,
            [tableName],
        );

        const indexMap = new Map<string, IndexDef>();

        for (const row of result.rows) {
            const name = String(row["index_name"]);
            const existing = indexMap.get(name);

            if (existing) {
                existing.columns.push(String(row["column_name"]));
            }
            else {
                indexMap.set(name, {
                    name,
                    table: tableName,
                    unique: Boolean(row["is_unique"]),
                    columns: [String(row["column_name"])],
                    origin: "c",
                });
            }
        }

        return [...indexMap.values()];
    }

    protected async getPrimaryKeyColumn(tableName: string): Promise<string> {
        const result = await this.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
             WHERE OBJECTPROPERTY(OBJECT_ID(CONSTRAINT_NAME), 'IsPrimaryKey') = 1
             AND TABLE_NAME = @p0 AND TABLE_SCHEMA = 'dbo'
             ORDER BY ORDINAL_POSITION`,
            [tableName],
        );

        if (result.rows.length === 0) {
            throw new Error(`No primary key found for table "${tableName}"`);
        }

        return String(result.rows[0]["COLUMN_NAME"]);
    }

    /**
     * Override pour utiliser la syntaxe MSSQL MERGE pour l'upsert.
     */
    public override async importData(tableName: string, format: "csv" | "json", data: string, mode: "insert" | "upsert"): Promise<void> {
        this.ensureOpen();

        const records = format === "json" ? this.parseJsonImport(data) : this.parseCsvImport(data);
        if (records.length === 0) {
            return;
        }

        const safeTable = this.escapeIdentifier(tableName);
        const columns = Object.keys(records[0]);
        const safeColumns = columns.map(c => this.escapeIdentifier(c)).join(", ");

        await this.execute("BEGIN TRANSACTION");
        try {
            for (const record of records) {
                const params = columns.map(c => record[c] ?? null);
                const placeholders = params.map((_, i) => `@p${i}`).join(", ");
                await this.execute(`INSERT INTO ${safeTable} (${safeColumns}) VALUES (${placeholders})`, params);
            }
            await this.execute("COMMIT");
        }
        catch (err) {
            await this.execute("ROLLBACK");
            throw err;
        }
    }

    /**
     * Override pour INSERT avec OUTPUT INSERTED pour récupérer l'ID.
     */
    public override async insertRow(tableName: string, values: Record<string, unknown>): Promise<number> {
        this.ensureOpen();
        const safeTable = this.escapeIdentifier(tableName);
        const columns = Object.keys(values);
        const safeColumns = columns.map(c => this.escapeIdentifier(c)).join(", ");
        const params = columns.map(c => values[c]);
        const placeholders = params.map((_, i) => `@p${i}`).join(", ");

        const pkColumn = await this.getPrimaryKeyColumn(tableName);
        const result = await this.query(
            `INSERT INTO ${safeTable} (${safeColumns}) OUTPUT INSERTED.${this.escapeIdentifier(pkColumn)} VALUES (${placeholders})`,
            params,
        );

        return Number(result.rows[0]?.[pkColumn] ?? 0);
    }

    /**
     * Override pour BEGIN TRANSACTION (syntaxe MSSQL).
     */
    public override async beginTransaction(): Promise<void> {
        this.ensureOpen();
        if (this._inTransaction) {
            throw new Error("A transaction is already active");
        }
        await this.execute("BEGIN TRANSACTION");
        this._inTransaction = true;
    }

    /**
     * Override pour DROP INDEX avec la syntaxe MSSQL (ON table).
     */
    public override async dropIndex(indexName: string): Promise<void> {
        this.ensureOpen();

        const result = await this.query(
            `SELECT OBJECT_NAME(object_id) AS table_name FROM sys.indexes WHERE name = @p0`,
            [indexName],
        );

        if (result.rows.length === 0) {
            throw new Error(`Index "${indexName}" not found`);
        }

        const table = String(result.rows[0]["table_name"]);
        await this.execute(`DROP INDEX ${this.escapeIdentifier(indexName)} ON ${this.escapeIdentifier(table)}`);
    }
}
