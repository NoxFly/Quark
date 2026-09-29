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
import pg from "pg";

/**
 * Driver PostgreSQL utilisant le package `pg`.
 * Se connecte via une URI `user:password@host:port/database`.
 */
export class PostgresqlDriver extends NetworkSqlDriver {
    public readonly driverType: DatabaseDriverType = "postgresql";
    private client: pg.Client | null = null;
    private paramIndex = 0;

    protected async connect(): Promise<void> {
        const p = this.connectionParams!;

        this.client = new pg.Client({
            host: p.host,
            port: p.port,
            user: p.user,
            password: p.password,
            database: p.database,
        });

        await this.client.connect();
    }

    protected async disconnect(): Promise<void> {
        await this.client?.end();
        this.client = null;
    }

    protected async query(sql: string, params: unknown[] = []): Promise<RawQueryResult> {
        // PostgreSQL utilise des placeholders $1, $2, ... au lieu de ?
        const pgSql = this.convertPlaceholders(sql);
        const result = await this.client!.query(pgSql, params);

        return {
            rows: result.rows as Record<string, unknown>[],
            affectedRows: result.rowCount ?? 0,
        };
    }

    protected async execute(sql: string, params: unknown[] = []): Promise<{ affectedRows: number; insertId?: number }> {
        const pgSql = this.convertPlaceholders(sql);
        const result = await this.client!.query(pgSql, params);

        return {
            affectedRows: result.rowCount ?? 0,
        };
    }

    /**
     * Convertit les placeholders `?` en `$1, $2, ...` pour PostgreSQL.
     */
    private convertPlaceholders(sql: string): string {
        this.paramIndex = 0;
        return sql.replace(/\?/g, () => {
            this.paramIndex++;
            return `$${this.paramIndex}`;
        });
    }

    protected async fetchTables(): Promise<string[]> {
        const result = await this.query(
            `SELECT tablename FROM pg_tables
             WHERE schemaname = 'public'
             ORDER BY tablename`,
        );
        return result.rows.map(row => String(row["tablename"]));
    }

    protected async fetchTableSchema(tableName: string): Promise<{ fields: FieldDef[]; recordCount: number }> {
        const columnsResult = await this.query(
            `SELECT column_name, data_type, is_nullable, column_default
             FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = $1
             ORDER BY ordinal_position`,
            [tableName],
        );

        // Récupérer les colonnes PK
        const pkResult = await this.query(
            `SELECT a.attname
             FROM pg_index i
             JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
             WHERE i.indrelid = $1::regclass AND i.indisprimary`,
            [tableName],
        );
        const pkColumns = new Set(pkResult.rows.map(r => String(r["attname"])));

        const fkMap = await this.fetchForeignKeys(tableName);

        const fields: FieldDef[] = columnsResult.rows.map(col => ({
            name: String(col["column_name"]),
            type: String(col["data_type"]).toUpperCase(),
            notnull: col["is_nullable"] === "NO",
            dflt_value: col["column_default"] !== null ? String(col["column_default"]) : null,
            pk: pkColumns.has(String(col["column_name"])),
            fk: fkMap.get(String(col["column_name"])) ?? null,
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
                kcu.column_name,
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name
             FROM information_schema.table_constraints AS tc
             JOIN information_schema.key_column_usage AS kcu
                ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
             JOIN information_schema.constraint_column_usage AS ccu
                ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
             WHERE tc.constraint_type = 'FOREIGN KEY'
                AND tc.table_schema = 'public'
                AND tc.table_name = $1`,
            [tableName],
        );

        const fkMap = new Map<string, ForeignKeyDef>();
        for (const row of result.rows) {
            fkMap.set(String(row["column_name"]), {
                table: String(row["foreign_table_name"]),
                column: String(row["foreign_column_name"]),
            });
        }
        return fkMap;
    }

    protected escapeIdentifier(name: string): string {
        return `"${name.replace(/"/g, '""')}"`;
    }

    protected async fetchTablesSql(): Promise<{ name: string; sql: string }[]> {
        const tables = await this.fetchTables();
        const results: { name: string; sql: string }[] = [];

        for (const table of tables) {
            // PostgreSQL n'a pas de SHOW CREATE TABLE, on reconstruit à partir du schéma
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
            `SELECT
                i.relname AS index_name,
                ix.indisunique AS is_unique,
                a.attname AS column_name
             FROM pg_class t
             JOIN pg_index ix ON t.oid = ix.indrelid
             JOIN pg_class i ON i.oid = ix.indexrelid
             JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
             WHERE t.relkind = 'r' AND t.relname = $1
             ORDER BY i.relname, a.attnum`,
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
            `SELECT a.attname
             FROM pg_index i
             JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
             WHERE i.indrelid = $1::regclass AND i.indisprimary
             LIMIT 1`,
            [tableName],
        );

        if (result.rows.length === 0) {
            throw new Error(`No primary key found for table "${tableName}"`);
        }

        return String(result.rows[0]["attname"]);
    }

    /**
     * Override pour utiliser la syntaxe PostgreSQL ON CONFLICT pour l'upsert.
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
                const placeholders = params.map((_, i) => `$${i + 1}`).join(", ");

                if (mode === "upsert") {
                    const pkColumn = await this.getPrimaryKeyColumn(tableName);
                    const updateCols = columns
                        .filter(c => c !== pkColumn)
                        .map(c => `${this.escapeIdentifier(c)} = EXCLUDED.${this.escapeIdentifier(c)}`)
                        .join(", ");
                    await this.execute(
                        `INSERT INTO ${safeTable} (${safeColumns}) VALUES (${placeholders})
                         ON CONFLICT (${this.escapeIdentifier(pkColumn)}) DO UPDATE SET ${updateCols}`,
                        params,
                    );
                }
                else {
                    await this.execute(
                        `INSERT INTO ${safeTable} (${safeColumns}) VALUES (${placeholders})`,
                        params,
                    );
                }
            }
            await this.execute("COMMIT");
        }
        catch (err) {
            await this.execute("ROLLBACK");
            throw err;
        }
    }

    /**
     * Override pour utiliser la syntaxe PostgreSQL avec ON + table.
     */
    public override async dropIndex(indexName: string): Promise<void> {
        this.ensureOpen();
        await this.execute(`DROP INDEX IF EXISTS ${this.escapeIdentifier(indexName)}`);
    }

    /**
     * Override pour INSERT RETURNING id dans PostgreSQL.
     */
    public override async insertRow(tableName: string, values: Record<string, unknown>): Promise<number> {
        this.ensureOpen();
        const safeTable = this.escapeIdentifier(tableName);
        const columns = Object.keys(values);
        const safeColumns = columns.map(c => this.escapeIdentifier(c)).join(", ");
        const params = columns.map(c => values[c]);
        const placeholders = params.map((_, i) => `$${i + 1}`).join(", ");

        const pkColumn = await this.getPrimaryKeyColumn(tableName);
        const result = await this.query(
            `INSERT INTO ${safeTable} (${safeColumns}) VALUES (${placeholders}) RETURNING ${this.escapeIdentifier(pkColumn)}`,
            params,
        );

        return Number(result.rows[0]?.[pkColumn] ?? 0);
    }
}
