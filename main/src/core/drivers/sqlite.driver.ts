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
import type { DatabaseDriverType } from "@shared/driver";
import type { DbRecord, R_SqlExecResponse } from "@shared/types";
import { SqliteDialectDriver } from "src/core/drivers/sqlite-dialect.driver";
import type { SqliteRunResult } from "src/core/drivers/sqlite-dialect.types";
import DatabaseConstructor from "better-sqlite3-multiple-ciphers";
import type BetterSqlite3 from "better-sqlite3-multiple-ciphers";
import { statSync } from "node:fs";
import { basename } from "node:path";

/**
 * Driver SQLite utilisant better-sqlite3-multiple-ciphers.
 * Supporte les fichiers locaux, le chiffrement SQLCipher,
 * les transactions, et toutes les opérations DDL/DML.
 *
 * Le dialecte (schéma, pagination, filtres, DDL…) est partagé avec le driver
 * libSQL dans `SqliteDialectDriver` ; ce driver n'apporte que l'accès au fichier.
 */
export class SqliteDriver extends SqliteDialectDriver {
    public readonly driverType: DatabaseDriverType = "sqlite";

    private db: BetterSqlite3.Database | null = null;
    private filePath: string | null = null;

    // --- Cycle de vie ---

    /**
     * Ouvre une base de données SQLite.
     * Retourne `true` si un mot de passe est nécessaire (base chiffrée).
     */
    public async open(filePath: string): Promise<boolean> {
        await this.close();
        this.filePath = filePath;

        try {
            this.db = new DatabaseConstructor(filePath);

            // Tester si la base est chiffrée en exécutant une requête système
            try {
                this.db.prepare("SELECT count(*) FROM sqlite_master").get();
                Logger.info(`Database opened: ${filePath}`);
                return false;
            }
            catch {
                // La requête échoue → la base est probablement chiffrée
                this.db.close();
                this.db = null;
                Logger.info(`Database is encrypted: ${filePath}`);
                return true;
            }
        }
        catch (err) {
            this.db = null;
            this.filePath = null;
            throw new Error(`Failed to open database: ${err}`);
        }
    }

    /**
     * Déchiffre et ouvre une base chiffrée avec le mot de passe fourni.
     */
    public async unlock(password: string): Promise<void> {
        if (!this.filePath) {
            throw new Error("No database file to unlock");
        }

        try {
            this.db = new DatabaseConstructor(this.filePath);
            // `key()` transmet le secret tel quel à SQLite3MultipleCiphers : aucun
            // échappement à maintenir, contrairement à un `PRAGMA key='...'` concaténé.
            this.db.key(Buffer.from(password, "utf8"));

            // Vérifier que le mot de passe est correct
            this.db.prepare("SELECT count(*) FROM sqlite_master").get();
            Logger.info(`Database unlocked: ${this.filePath}`);
        }
        catch {
            this.db?.close();
            this.db = null;
            throw new Error("Invalid password or corrupted database");
        }
    }

    /**
     * Ferme la connexion à la base de données.
     */
    public async close(): Promise<void> {
        if (this.inTransaction) {
            try {
                await this.rollback();
            }
            catch {
                // Ignorer les erreurs de rollback lors de la fermeture
            }
        }

        this.db?.close();
        this.db = null;
        this.filePath = null;
        this.inTransaction = false;
    }

    public get isOpen(): boolean {
        return this.db !== null;
    }

    public get path(): string | null {
        return this.filePath;
    }

    // --- Transport ---

    protected get databaseName(): string {
        return this.filePath ? basename(this.filePath) : "unknown";
    }

    protected async queryAll(sql: string, params: unknown[] = []): Promise<DbRecord[]> {
        return this.requireDb().prepare(sql).all(...params) as DbRecord[];
    }

    protected async run(sql: string, params: unknown[] = []): Promise<SqliteRunResult> {
        const result = this.requireDb().prepare(sql).run(...params);

        return { changes: result.changes, lastInsertRowid: Number(result.lastInsertRowid) };
    }

    protected override getStorageSize(): number {
        try {
            return this.filePath ? statSync(this.filePath).size : 0;
        }
        catch {
            // Ignorer si on ne peut pas obtenir la taille
            return 0;
        }
    }

    // --- Import ---

    /**
     * Importe des données dans une table depuis du CSV ou JSON, en une transaction.
     */
    public async importData(tableName: string, format: "csv" | "json", data: string, mode: "insert" | "upsert"): Promise<void> {
        this.ensureOpen();

        const plan = this.prepareImport(tableName, format, data, mode);

        if (!plan) {
            return;
        }

        const db = this.requireDb();
        const statement = db.prepare(plan.sql);
        const runAll = db.transaction((rows: unknown[][]) => {
            for (const row of rows) {
                statement.run(...row);
            }
        });

        runAll(plan.rows);
    }

    // --- SQL ---

    /**
     * Exécute une requête SQL arbitraire et retourne les résultats.
     */
    public async execSql(sql: string, maxRows?: number): Promise<R_SqlExecResponse> {
        this.ensureOpen();

        let trimmed = sql.trim();
        trimmed = trimmed.endsWith(";") ? trimmed : `${trimmed};`;

        const t0 = performance.now();

        try {
            const stmt = this.requireDb().prepare(trimmed);

            if (this.isReadStatement(trimmed)) {
                // `raw()` renvoie directement des tableaux, dans l'ordre des colonnes :
                // ni objet intermédiaire par ligne, ni conversion après coup.
                const columns = stmt.columns().map(c => c.name);
                const rows: unknown[][] = [];
                let truncated = false;

                // `iterate()` lit ligne à ligne : un SELECT sur une très grosse table
                // s'arrête au plafond au lieu de tout charger en mémoire.
                for (const row of stmt.raw(true).iterate() as IterableIterator<unknown[]>) {
                    if (maxRows !== undefined && rows.length >= maxRows) {
                        truncated = true;
                        break;
                    }

                    rows.push(row);
                }

                return {
                    columns,
                    rows,
                    rowsAffected: 0,
                    isSelect: true,
                    executionTimeMs: performance.now() - t0,
                    truncated,
                };
            }

            const result = stmt.run();

            return {
                columns: [],
                rows: [],
                rowsAffected: result.changes,
                lastInsertId: Number(result.lastInsertRowid) || undefined,
                isSelect: false,
                executionTimeMs: performance.now() - t0,
            };
        }
        catch (err) {
            throw new Error(`SQL error: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    // --- Chiffrement ---

    /**
     * Change ou supprime le mot de passe de la base SQLCipher.
     */
    public async changePassword(newPassword: string | null): Promise<void> {
        this.ensureOpen();

        // Une clé vide retire le chiffrement.
        this.requireDb().rekey(Buffer.from(newPassword ?? "", "utf8"));

        Logger.info("Database password changed");
    }

    // --- Helpers privés ---

    private requireDb(): BetterSqlite3.Database {
        if (!this.db) {
            throw new Error("Database is not open");
        }

        return this.db;
    }
}
