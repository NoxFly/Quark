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
import mysql from "mysql2/promise";

/**
 * Driver MySQL utilisant mysql2.
 * Se connecte via une URI `user:password@host:port/database`.
 */
export class MysqlDriver extends NetworkSqlDriver {
    public readonly driverType: DatabaseDriverType = "mysql";
    private connection: mysql.Connection | null = null;

    protected async connect(): Promise<void> {
        const p = this.connectionParams!;

        this.connection = await mysql.createConnection({
            host: p.host,
            port: p.port,
            user: p.user,
            password: p.password,
            database: p.database,
            multipleStatements: false,
        });
    }

    protected async disconnect(): Promise<void> {
        await this.connection?.end();
        this.connection = null;
    }

    protected async query(sql: string, params: unknown[] = []): Promise<RawQueryResult> {
        const [rows] = await this.connection!.execute(sql, params as (string | number | null)[]);
        return {
            rows: Array.isArray(rows) ? rows as Record<string, unknown>[] : [],
            affectedRows: 0,
        };
    }

    protected async execute(sql: string, params: unknown[] = []): Promise<{ affectedRows: number; insertId?: number }> {
        const [result] = await this.connection!.execute(sql, params as (string | number | null)[]);
        const r = result as mysql.ResultSetHeader;
        return {
            affectedRows: r.affectedRows ?? 0,
            insertId: r.insertId ? Number(r.insertId) : undefined,
        };
    }

    protected async fetchTables(): Promise<string[]> {
        const result = await this.query("SHOW TABLES");
        return result.rows.map(row => Object.values(row)[0] as string);
    }

    protected async fetchTableSchema(tableName: string): Promise<{ fields: FieldDef[]; recordCount: number }> {
        const columnsResult = await this.query(
            `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
             ORDER BY ORDINAL_POSITION`,
            [this.connectionParams!.database, tableName],
        );

        const fkMap = await this.fetchForeignKeys(tableName);

        const fields: FieldDef[] = columnsResult.rows.map(col => ({
            name: String(col["COLUMN_NAME"]),
            type: String(col["DATA_TYPE"]).toUpperCase(),
            notnull: col["IS_NULLABLE"] === "NO",
            dflt_value: col["COLUMN_DEFAULT"] !== null ? String(col["COLUMN_DEFAULT"]) : null,
            pk: col["COLUMN_KEY"] === "PRI",
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
            `SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
             FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
            [this.connectionParams!.database, tableName],
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
        return `\`${name.replace(/`/g, "``")}\``;
    }

    protected async fetchTablesSql(): Promise<{ name: string; sql: string }[]> {
        const tables = await this.fetchTables();
        const results: { name: string; sql: string }[] = [];

        for (const table of tables) {
            const result = await this.query(`SHOW CREATE TABLE ${this.escapeIdentifier(table)}`);
            if (result.rows.length > 0) {
                results.push({ name: table, sql: String(result.rows[0]["Create Table"] ?? "") });
            }
        }

        return results;
    }

    protected async fetchIndexes(tableName: string): Promise<IndexDef[]> {
        const result = await this.query(`SHOW INDEX FROM ${this.escapeIdentifier(tableName)}`);

        const indexMap = new Map<string, IndexDef>();

        for (const row of result.rows) {
            const name = String(row["Key_name"]);
            const existing = indexMap.get(name);

            if (existing) {
                existing.columns.push(String(row["Column_name"]));
            }
            else {
                indexMap.set(name, {
                    name,
                    table: tableName,
                    unique: Number(row["Non_unique"]) === 0,
                    columns: [String(row["Column_name"])],
                    origin: name === "PRIMARY" ? "pk" : "c",
                });
            }
        }

        return [...indexMap.values()];
    }

    protected async getPrimaryKeyColumn(tableName: string): Promise<string> {
        const result = await this.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'
             ORDER BY ORDINAL_POSITION LIMIT 1`,
            [this.connectionParams!.database, tableName],
        );

        if (result.rows.length === 0) {
            throw new Error(`No primary key found for table "${tableName}"`);
        }

        return String(result.rows[0]["COLUMN_NAME"]);
    }

    /**
     * Override pour utiliser la syntaxe MySQL REPLACE INTO pour l'upsert.
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
        const placeholders = columns.map(() => "?").join(", ");

        const keyword = mode === "upsert" ? "REPLACE" : "INSERT";

        await this.execute("BEGIN");
        try {
            for (const record of records) {
                const params = columns.map(c => record[c] ?? null);
                await this.execute(`${keyword} INTO ${safeTable} (${safeColumns}) VALUES (${placeholders})`, params);
            }
            await this.execute("COMMIT");
        }
        catch (err) {
            await this.execute("ROLLBACK");
            throw err;
        }
    }

    /**
     * Override pour supprimer un index avec la syntaxe MySQL (ON table).
     */
    public override async dropIndex(indexName: string): Promise<void> {
        this.ensureOpen();
        // MySQL nécessite le nom de la table pour DROP INDEX
        // On cherche la table à partir de INFORMATION_SCHEMA
        const result = await this.query(
            `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.STATISTICS
             WHERE TABLE_SCHEMA = ? AND INDEX_NAME = ? LIMIT 1`,
            [this.connectionParams!.database, indexName],
        );

        if (result.rows.length === 0) {
            throw new Error(`Index "${indexName}" not found`);
        }

        const table = String(result.rows[0]["TABLE_NAME"]);
        await this.execute(`DROP INDEX ${this.escapeIdentifier(indexName)} ON ${this.escapeIdentifier(table)}`);
    }
}
