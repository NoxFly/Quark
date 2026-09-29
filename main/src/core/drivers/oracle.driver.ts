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

import type { DatabaseDriverType } from "@shared/driver";
import type { FieldDef, ForeignKeyDef, IndexDef } from "@shared/types";
import { NetworkSqlDriver, type RawQueryResult } from "src/core/drivers/network-sql.driver";
import oracledb from "oracledb";

/**
 * Driver Oracle utilisant oracledb (node-oracledb).
 * Se connecte via une URI `user:password@host:port/service_name`.
 */
export class OracleDriver extends NetworkSqlDriver {
    public readonly driverType: DatabaseDriverType = "oracle";
    private connection: oracledb.Connection | null = null;

    protected async connect(): Promise<void> {
        const p = this.connectionParams!;

        this.connection = await oracledb.getConnection({
            user: p.user,
            password: p.password,
            connectString: `${p.host}:${p.port}/${p.database}`,
        });

        // Retourner les résultats sous forme d'objets
        oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
    }

    protected async disconnect(): Promise<void> {
        await this.connection?.close();
        this.connection = null;
    }

    protected async query(sql: string, params: unknown[] = []): Promise<RawQueryResult> {
        const oracleSql = this.convertPlaceholders(sql);
        const result = await this.connection!.execute(oracleSql, params, { outFormat: oracledb.OUT_FORMAT_OBJECT });

        return {
            rows: (result.rows ?? []) as Record<string, unknown>[],
            affectedRows: result.rowsAffected ?? 0,
        };
    }

    protected async execute(sql: string, params: unknown[] = []): Promise<{ affectedRows: number; insertId?: number }> {
        const oracleSql = this.convertPlaceholders(sql);
        const result = await this.connection!.execute(oracleSql, params, { autoCommit: !this._inTransaction });

        return {
            affectedRows: result.rowsAffected ?? 0,
        };
    }

    /**
     * Convertit les placeholders `?` en `:1, :2, ...` pour Oracle.
     */
    private convertPlaceholders(sql: string): string {
        let idx = 0;
        return sql.replace(/\?/g, () => {
            idx++;
            return `:${idx}`;
        });
    }

    protected async fetchTables(): Promise<string[]> {
        const result = await this.query(
            `SELECT table_name FROM user_tables ORDER BY table_name`,
        );
        return result.rows.map(row => String(row["TABLE_NAME"]));
    }

    protected async fetchTableSchema(tableName: string): Promise<{ fields: FieldDef[]; recordCount: number }> {
        const columnsResult = await this.query(
            `SELECT column_name, data_type, nullable, data_default
             FROM user_tab_columns
             WHERE table_name = :1
             ORDER BY column_id`,
            [tableName.toUpperCase()],
        );

        // Récupérer les PK
        const pkResult = await this.query(
            `SELECT cols.column_name
             FROM user_constraints cons
             JOIN user_cons_columns cols ON cons.constraint_name = cols.constraint_name
             WHERE cons.constraint_type = 'P' AND cons.table_name = :1`,
            [tableName.toUpperCase()],
        );
        const pkColumns = new Set(pkResult.rows.map(r => String(r["COLUMN_NAME"])));

        const fkMap = await this.fetchForeignKeys(tableName);

        const fields: FieldDef[] = columnsResult.rows.map(col => ({
            name: String(col["COLUMN_NAME"]),
            type: String(col["DATA_TYPE"]).toUpperCase(),
            notnull: col["NULLABLE"] === "N",
            dflt_value: col["DATA_DEFAULT"] !== null ? String(col["DATA_DEFAULT"]).trim() : null,
            pk: pkColumns.has(String(col["COLUMN_NAME"])),
            fk: fkMap.get(String(col["COLUMN_NAME"])) ?? null,
        }));

        const countResult = await this.query(
            `SELECT COUNT(*) AS cnt FROM ${this.escapeIdentifier(tableName)}`,
        );
        const recordCount = Number(countResult.rows[0]?.["CNT"] ?? 0);

        return { fields, recordCount };
    }

    protected async fetchForeignKeys(tableName: string): Promise<Map<string, ForeignKeyDef>> {
        const result = await this.query(
            `SELECT a.column_name, c_pk.table_name AS r_table_name, b.column_name AS r_column_name
             FROM user_cons_columns a
             JOIN user_constraints c ON a.constraint_name = c.constraint_name
             JOIN user_constraints c_pk ON c.r_constraint_name = c_pk.constraint_name
             JOIN user_cons_columns b ON b.constraint_name = c_pk.constraint_name
             WHERE c.constraint_type = 'R' AND c.table_name = :1`,
            [tableName.toUpperCase()],
        );

        const fkMap = new Map<string, ForeignKeyDef>();
        for (const row of result.rows) {
            fkMap.set(String(row["COLUMN_NAME"]), {
                table: String(row["R_TABLE_NAME"]),
                column: String(row["R_COLUMN_NAME"]),
            });
        }
        return fkMap;
    }

    protected escapeIdentifier(name: string): string {
        return `"${name.replace(/"/g, '""')}"`;
    }

    protected async fetchTablesSql(): Promise<{ name: string; sql: string }[]> {
        // Oracle ne fournit pas directement SHOW CREATE TABLE, on utilise DBMS_METADATA
        const tables = await this.fetchTables();
        const results: { name: string; sql: string }[] = [];

        for (const table of tables) {
            try {
                const result = await this.query(
                    `SELECT DBMS_METADATA.GET_DDL('TABLE', :1) AS ddl FROM DUAL`,
                    [table.toUpperCase()],
                );
                if (result.rows.length > 0) {
                    results.push({ name: table, sql: String(result.rows[0]["DDL"] ?? "") });
                }
            }
            catch {
                // Fallback : reconstruire depuis le schéma
                const { fields } = await this.fetchTableSchema(table);
                const colDefs = fields.map(f => {
                    let def = `${this.escapeIdentifier(f.name)} ${f.type}`;
                    if (f.pk) {
                        def += " PRIMARY KEY";
                    }
                    if (f.notnull && !f.pk) {
                        def += " NOT NULL";
                    }
                    return def;
                });
                results.push({ name: table, sql: `CREATE TABLE ${this.escapeIdentifier(table)} (${colDefs.join(", ")})` });
            }
        }

        return results;
    }

    protected async fetchIndexes(tableName: string): Promise<IndexDef[]> {
        const result = await this.query(
            `SELECT i.index_name, i.uniqueness, ic.column_name
             FROM user_indexes i
             JOIN user_ind_columns ic ON i.index_name = ic.index_name
             WHERE i.table_name = :1
             ORDER BY i.index_name, ic.column_position`,
            [tableName.toUpperCase()],
        );

        const indexMap = new Map<string, IndexDef>();

        for (const row of result.rows) {
            const name = String(row["INDEX_NAME"]);
            const existing = indexMap.get(name);

            if (existing) {
                existing.columns.push(String(row["COLUMN_NAME"]));
            }
            else {
                indexMap.set(name, {
                    name,
                    table: tableName,
                    unique: row["UNIQUENESS"] === "UNIQUE",
                    columns: [String(row["COLUMN_NAME"])],
                    origin: "c",
                });
            }
        }

        return [...indexMap.values()];
    }

    protected async getPrimaryKeyColumn(tableName: string): Promise<string> {
        const result = await this.query(
            `SELECT cols.column_name
             FROM user_constraints cons
             JOIN user_cons_columns cols ON cons.constraint_name = cols.constraint_name
             WHERE cons.constraint_type = 'P' AND cons.table_name = :1
             ORDER BY cols.position FETCH FIRST 1 ROWS ONLY`,
            [tableName.toUpperCase()],
        );

        if (result.rows.length === 0) {
            throw new Error(`No primary key found for table "${tableName}"`);
        }

        return String(result.rows[0]["COLUMN_NAME"]);
    }

    /**
     * Override pour utiliser MERGE pour l'upsert Oracle.
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

        await this.execute("BEGIN");
        try {
            for (const record of records) {
                const params = columns.map(c => record[c] ?? null);
                const placeholders = params.map((_, i) => `:${i + 1}`).join(", ");
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
     * Override beginTransaction pour Oracle (BEGIN n'existe pas, on utilise un savepoint implicite).
     */
    public override async beginTransaction(): Promise<void> {
        this.ensureOpen();
        if (this._inTransaction) {
            throw new Error("A transaction is already active");
        }
        // Oracle démarre implicitement les transactions, pas besoin de BEGIN explicite
        this._inTransaction = true;
    }

    /**
     * Override commit pour Oracle.
     */
    public override async commit(): Promise<void> {
        this.ensureOpen();
        if (!this._inTransaction) {
            throw new Error("No active transaction");
        }
        await this.connection!.commit();
        this._inTransaction = false;
    }

    /**
     * Override rollback pour Oracle.
     */
    public override async rollback(): Promise<void> {
        this.ensureOpen();
        if (!this._inTransaction) {
            throw new Error("No active transaction");
        }
        await this.connection!.rollback();
        this._inTransaction = false;
    }

    /**
     * Override pour utiliser la pagination Oracle (OFFSET ROWS FETCH).
     */
    protected override extractOrderByFromFilter(filter: string): { whereClause: string; orderClause: string } {
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
     * Override pour utiliser la pagination Oracle (OFFSET ROWS FETCH).
     */
    public override async getTableData(
        tableName: string,
        offset: number,
        limit: number,
        orderBy?: string,
        orderDir?: "ASC" | "DESC",
        filter?: string,
        filterMode: "sql" | "fulltext" = "fulltext",
    ): Promise<{ records: import("@shared/types").DbRecord[]; totalCount: number; tableSize: number }> {
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
                const conditions = fields.map(f => `CAST(${this.escapeIdentifier(f.name)} AS VARCHAR2(4000)) LIKE :${whereParams.length + 1}`);
                const likeParam = `%${filter.trim()}%`;
                for (const _f of fields) {
                    whereParams.push(likeParam);
                }
                whereClause = ` WHERE (${conditions.join(" OR ")})`;
            }
        }

        const countResult = await this.query(
            `SELECT COUNT(*) AS cnt FROM ${safeTable}${whereClause}`,
            whereParams,
        );
        const totalCount = Number(countResult.rows[0]?.["CNT"] ?? 0);

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
                // Si pas de clé primaire trouvée, pas de tri par défaut
            }
        }

        const dataResult = await this.query(
            `SELECT * FROM ${safeTable}${whereClause}${orderClause} OFFSET :${whereParams.length + 1} ROWS FETCH NEXT :${whereParams.length + 2} ROWS ONLY`,
            [...whereParams, offset, limit],
        );

        return {
            records: dataResult.rows as import("@shared/types").DbRecord[],
            totalCount,
            tableSize: 0,
        };
    }
}
