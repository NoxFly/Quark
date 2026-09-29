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
// Client « web » : HTTP / WebSocket en JavaScript pur. Le point d'entrée par défaut
// charge le module natif `libsql` (fichiers locaux, réplicas embarqués), inutile ici
// et qu'il faudrait sortir de l'asar à chaque plateforme.
import { type Client, type Config, createClient, type InValue, type ResultSet } from "@libsql/client/web";
import type { DatabaseDriverType, DriverConnectionOptions } from "@shared/driver";
import type { DbRecord, R_SqlExecResponse } from "@shared/types";
import { errorChainMessage, toTimeoutMs, withDeadline } from "src/core/drivers/connection-target.helper";
import { SqliteDialectDriver } from "src/core/drivers/sqlite-dialect.driver";
import type { SqliteRunResult, SqliteStatement } from "src/core/drivers/sqlite-dialect.types";

/** Délai d'établissement par défaut : le client libSQL n'en a pas lui-même. */
const DEFAULT_CONNECT_TIMEOUT_MS = 20_000;

/** Écritures qui peuvent porter un `RETURNING` : elles restent des modifications. */
const WRITE_STATEMENT = /^\s*(?:INSERT|UPDATE|DELETE|REPLACE)\b/i;

type ClientFactory = (config: Config) => Client;

/**
 * Driver SQLite distant : libSQL (sqld) et Turso, via `@libsql/client/web`.
 *
 * Même dialecte que le driver fichier (`SqliteDialectDriver`) ; seul le transport
 * change. Les lectures multiples (schéma, page + total) partent en un seul lot,
 * les imports en un lot atomique.
 *
 * Pas de transactions interactives : un serveur libSQL verrouille la base en
 * écriture pendant une transaction et l'abandonne au bout de quelques secondes
 * d'inactivité (5 s chez Turso). Le mode transaction de Quark, qui garde une
 * transaction ouverte le temps que l'utilisateur édite, y échouerait au commit.
 * Pas de chiffrement non plus : il est géré par le serveur.
 */
export class LibsqlDriver extends SqliteDialectDriver {
    public readonly driverType: DatabaseDriverType = "libsql";

    private client: Client | null = null;
    private url: string | null = null;
    private options: DriverConnectionOptions = {};

    /**
     * @param clientFactory - Fabrique du client ; les tests y substituent le client
     * complet (`file:`), dont les résultats ont exactement la même forme.
     */
    public constructor(private readonly clientFactory: ClientFactory = createClient) {
        super();
    }

    public override async configureConnection(options: DriverConnectionOptions): Promise<void> {
        this.options = { ...options };
    }

    // --- Cycle de vie ---

    /**
     * Se connecte à la base désignée par `url` et vérifie qu'elle répond.
     * @returns Toujours `false` : aucun mot de passe de fichier n'est demandé.
     */
    public async open(url: string): Promise<boolean> {
        await this.close();

        const client = this.clientFactory({
            url,
            authToken: this.options.authToken,
            // Les entiers au-delà de 2^53 lèveraient en mode « number » : on les lit
            // en bigint, puis on ne garde en bigint que ce qui ne tient pas.
            intMode: "bigint",
        });
        const timeoutMs = toTimeoutMs(this.options.timeoutSeconds) ?? DEFAULT_CONNECT_TIMEOUT_MS;

        try {
            // Le client est paresseux : sans requête, une URL ou un jeton faux ne se
            // révéleraient qu'à la lecture du schéma.
            await withDeadline(client.execute("SELECT 1"), timeoutMs, `Connection timed out after ${timeoutMs / 1000}s`);
        }
        catch (error) {
            client.close();
            throw new Error(`Failed to connect to libsql: ${errorChainMessage(error)}`);
        }

        this.client = client;
        this.url = url;
        Logger.info(`Connected to remote SQLite: ${url}`);

        return false;
    }

    public async unlock(_password: string): Promise<void> {
        throw new Error("Remote SQLite databases are not encrypted by the client");
    }

    public async close(): Promise<void> {
        this.client?.close();
        this.client = null;
        this.url = null;
        this.inTransaction = false;
    }

    public get isOpen(): boolean {
        return this.client !== null;
    }

    public get path(): string | null {
        return this.url;
    }

    // --- Transactions ---

    public override async beginTransaction(): Promise<void> {
        throw new Error("Transactions are not supported on remote SQLite databases");
    }

    public override async commit(): Promise<void> {
        throw new Error("No active transaction");
    }

    public override async rollback(): Promise<void> {
        throw new Error("No active transaction");
    }

    // --- Transport ---

    protected get databaseName(): string {
        if (!this.url) {
            return "unknown";
        }

        try {
            return new URL(this.url).hostname || this.url;
        }
        catch {
            return this.url;
        }
    }

    protected async queryAll(sql: string, params: unknown[] = []): Promise<DbRecord[]> {
        const result = await this.requireClient().execute({ sql, args: toArgs(params) });

        return toRecords(result);
    }

    protected async run(sql: string, params: unknown[] = []): Promise<SqliteRunResult> {
        const result = await this.requireClient().execute({ sql, args: toArgs(params) });

        return { changes: result.rowsAffected, lastInsertRowid: Number(result.lastInsertRowid ?? 0) };
    }

    /** Un seul aller-retour pour toutes les lectures : la lecture du schéma en émet trois par table. */
    protected override async queryBatch(statements: SqliteStatement[]): Promise<DbRecord[][]> {
        if (statements.length === 0) {
            return [];
        }

        const results = await this.requireClient().batch(
            statements.map(statement => ({ sql: statement.sql, args: toArgs(statement.params ?? []) })),
            "read",
        );

        return results.map(toRecords);
    }

    // --- Import ---

    /**
     * Importe en un lot `write` : le serveur l'exécute dans une transaction, donc
     * tout ou rien, sans transaction interactive.
     */
    public async importData(tableName: string, format: "csv" | "json", data: string, mode: "insert" | "upsert"): Promise<void> {
        this.ensureOpen();

        const plan = this.prepareImport(tableName, format, data, mode);

        if (!plan) {
            return;
        }

        await this.requireClient().batch(plan.rows.map(row => ({ sql: plan.sql, args: toArgs(row) })), "write");
    }

    // --- SQL ---

    public async execSql(sql: string, maxRows?: number): Promise<R_SqlExecResponse> {
        this.ensureOpen();

        const t0 = performance.now();
        let result: ResultSet;

        try {
            result = await this.requireClient().execute(sql.trim());
        }
        catch (err) {
            throw new Error(`SQL error: ${err instanceof Error ? err.message : String(err)}`);
        }

        const executionTimeMs = performance.now() - t0;

        // Une instruction qui renvoie des colonnes est une lecture (SELECT, WITH,
        // PRAGMA…), sauf une écriture avec `RETURNING`, qui doit rester journalisée.
        if (result.columns.length > 0 && !WRITE_STATEMENT.test(sql)) {
            // Le client rapatrie le résultat entier : le plafond ne protège ici que
            // l'IPC et la mémoire de l'hôte, pas le serveur.
            const truncated = maxRows !== undefined && result.rows.length > maxRows;
            const rows = truncated ? result.rows.slice(0, maxRows) : result.rows;

            return {
                columns: [...result.columns],
                rows: rows.map(row => result.columns.map((_, index) => toPlainValue(row[index]))),
                rowsAffected: 0,
                isSelect: true,
                executionTimeMs,
                truncated,
            };
        }

        return {
            columns: [],
            rows: [],
            // Selon le serveur, une écriture avec `RETURNING` ne compte pas ses lignes :
            // celles renvoyées en sont alors la mesure.
            rowsAffected: result.rowsAffected || result.rows.length,
            lastInsertId: Number(result.lastInsertRowid ?? 0) || undefined,
            isSelect: false,
            executionTimeMs,
        };
    }

    // --- Chiffrement ---

    public async changePassword(_newPassword: string | null): Promise<void> {
        throw new Error("Remote SQLite databases are not encrypted by the client");
    }

    // --- Helpers privés ---

    private requireClient(): Client {
        if (!this.client) {
            throw new Error("Database is not open");
        }

        return this.client;
    }
}

/**
 * Convertit un résultat en objets simples. Les lignes du client portent leurs
 * valeurs en propriétés non énumérables, que le clonage structuré de l'IPC perdrait.
 */
function toRecords(result: ResultSet): DbRecord[] {
    return result.rows.map(row => {
        const record: DbRecord = {};

        result.columns.forEach((column, index) => {
            record[column] = toPlainValue(row[index]);
        });

        return record;
    });
}

/**
 * Ramène une valeur libSQL à ce que produit better-sqlite3 : nombre quand il est
 * exact, chaîne sinon (un bigint ne passe pas `JSON.stringify` à l'export), et
 * `Buffer` pour un BLOB.
 */
function toPlainValue(value: unknown): unknown {
    if (typeof value === "bigint") {
        const isSafe = value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER);

        return isSafe ? Number(value) : value.toString();
    }

    if (value instanceof ArrayBuffer) {
        return Buffer.from(value);
    }

    return value;
}

/** Les valeurs viennent du renderer : seuls les types connus du protocole sont transmis tels quels. */
function toArgs(params: unknown[]): InValue[] {
    return params.map(param => {
        if (param === undefined) {
            return null;
        }

        if (param === null || typeof param === "string" || typeof param === "number" || typeof param === "bigint"
            || typeof param === "boolean" || param instanceof Uint8Array || param instanceof ArrayBuffer || param instanceof Date) {
            return param;
        }

        // Un objet (JSON d'une cellule) est stocké sous sa forme textuelle, comme le ferait SQLite.
        return JSON.stringify(param);
    });
}
