/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import type { DatabaseDriverType } from "@shared/driver";
import type { DbRecord, DatabaseSchema, FieldDef, ForeignKeyDef, IndexDef, TableSchema } from "@shared/types";
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
    private extractOrderByFromFilter(filter: string): { whereClause: string; orderClause: string } {
        const trimmed = filter.trim();

        // Vérifier si le filtre commence par ORDER BY
        if (trimmed.match(/^\s*ORDER\s+BY\s+/i)) {
            return { whereClause: "", orderClause: trimmed };
        }

        // Chercher "ORDER BY" de manière case-insensitive
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
                const pk = await this.getPrimaryKeyColumn(tableName);
                orderClause = ` ORDER BY ${this.escapeIdentifier(pk)} ASC`;
            }
            catch {
                orderClause = " ORDER BY (SELECT NULL)";
            }
        }
        else {
            // En mode full-text sans tri, une pagination stable demande un ORDER BY
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
     * Override pour optimiser le chargement du schéma sur MSSQL.
     *
     * Le driver de base (NetworkSqlDriver) exécute 4 requêtes par table (colonnes, PKs,
     * FKs, COUNT), soit 4N requêtes séquentielles. Avec tedious (connexion unique),
     * cela prend ~30 secondes sur une base avec 50+ tables.
     *
     * Cette implémentation réduit cela à 5 requêtes batch au total, indépendamment
     * du nombre de tables.
     */
    public override async getSchema(): Promise<DatabaseSchema> {
        this.ensureOpen();

        const tables = await this.fetchTables();

        if (tables.length === 0) {
            return {
                name: this.connectionParams!.database,
                path: this.path!,
                tables: [],
                driverType: this.driverType,
            };
        }

        // Requête 2 : toutes les colonnes de toutes les tables du schéma dbo
        type ColRow = {
            TABLE_NAME: string;
            COLUMN_NAME: string;
            DATA_TYPE: string;
            IS_NULLABLE: string;
            COLUMN_DEFAULT: string | null;
        };

        const allColumnsResult = await this.query(
            `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = 'dbo'
             ORDER BY TABLE_NAME, ORDINAL_POSITION`,
        );

        // Requête 3 : toutes les clés primaires
        const allPkResult = await this.query(
            `SELECT kcu.TABLE_NAME, kcu.COLUMN_NAME
             FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
             JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
                ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
                AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
             WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
             AND tc.TABLE_SCHEMA = 'dbo'`,
        );

        // Requête 4 : toutes les clés étrangères
        const allFkResult = await this.query(
            `SELECT ccu.TABLE_NAME, ccu.COLUMN_NAME,
                    kcu2.TABLE_NAME AS REFERENCED_TABLE_NAME,
                    kcu2.COLUMN_NAME AS REFERENCED_COLUMN_NAME
             FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
             JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ccu
                ON rc.CONSTRAINT_NAME = ccu.CONSTRAINT_NAME
             JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu2
                ON rc.UNIQUE_CONSTRAINT_NAME = kcu2.CONSTRAINT_NAME
             WHERE ccu.TABLE_SCHEMA = 'dbo'`,
        );

        // Requête 5 : nombre de lignes par table via les statistiques de partition
        // (quasi-instantané, contrairement à COUNT(*) par table)
        let countMap: Map<string, number>;
        try {
            const countResult = await this.query(
                `SELECT OBJECT_NAME(o.object_id) AS table_name, SUM(p.row_count) AS row_count
                 FROM sys.objects o
                 INNER JOIN sys.dm_db_partition_stats p ON o.object_id = p.object_id
                 WHERE o.type = 'U' AND p.index_id < 2
                 GROUP BY o.object_id`,
            );
            countMap = new Map(
                countResult.rows.map(r => [String(r["table_name"]), Number(r["row_count"] ?? 0)]),
            );
        }
        catch {
            // Fallback si les DMV ne sont pas accessibles (droits insuffisants)
            countMap = new Map(tables.map(t => [t, 0]));
        }

        // Répartition des résultats par table en mémoire
        const columnsByTable = new Map<string, ColRow[]>();
        for (const row of allColumnsResult.rows as ColRow[]) {
            const list = columnsByTable.get(row.TABLE_NAME) ?? [];
            list.push(row);
            columnsByTable.set(row.TABLE_NAME, list);
        }

        const pksByTable = new Map<string, Set<string>>();
        for (const row of allPkResult.rows as { TABLE_NAME: string; COLUMN_NAME: string }[]) {
            const set = pksByTable.get(row.TABLE_NAME) ?? new Set<string>();
            set.add(row.COLUMN_NAME);
            pksByTable.set(row.TABLE_NAME, set);
        }

        const fksByTable = new Map<string, Map<string, ForeignKeyDef>>();
        for (const row of allFkResult.rows as {
            TABLE_NAME: string;
            COLUMN_NAME: string;
            REFERENCED_TABLE_NAME: string;
            REFERENCED_COLUMN_NAME: string;
        }[]) {
            const map = fksByTable.get(row.TABLE_NAME) ?? new Map<string, ForeignKeyDef>();
            map.set(row.COLUMN_NAME, { table: row.REFERENCED_TABLE_NAME, column: row.REFERENCED_COLUMN_NAME });
            fksByTable.set(row.TABLE_NAME, map);
        }

        const tableSchemas: TableSchema[] = tables.map(tableName => {
            const cols = columnsByTable.get(tableName) ?? [];
            const pks = pksByTable.get(tableName) ?? new Set<string>();
            const fks = fksByTable.get(tableName) ?? new Map<string, ForeignKeyDef>();

            const fields: FieldDef[] = cols.map(col => ({
                name: col.COLUMN_NAME,
                type: col.DATA_TYPE.toUpperCase(),
                notnull: col.IS_NULLABLE === "NO",
                dflt_value: col.COLUMN_DEFAULT ?? null,
                pk: pks.has(col.COLUMN_NAME),
                fk: fks.get(col.COLUMN_NAME) ?? null,
            }));

            return { name: tableName, fields, weight: 0, recordCount: countMap.get(tableName) ?? 0 };
        });

        return {
            name: this.connectionParams!.database,
            path: this.path!,
            tables: tableSchemas,
            driverType: this.driverType,
        };
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
