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

import { randomUUID } from "node:crypto";
import type { DatabaseDriverType } from "@shared/driver";
import type { R_SqlExecResponse } from "@shared/types";
import type { DatabaseDriver } from "src/core/drivers/driver.interface";
import {
    type DriverHostRequest,
    type DriverHostResponse,
    type DriverHostState,
    SQL_FIRST_PAGE_SIZE,
    SQL_MAX_RESULT_ROWS,
} from "src/core/driver-host/driver-host.protocol";

/** Nombre de résultats SQL gardés en mémoire (un par éditeur ouvert, en pratique). */
const MAX_CACHED_RESULTS = 4;

/**
 * Méthodes de l'hôte lui-même, prioritaires sur celles du driver.
 * Toute autre méthode est cherchée sur le driver actif.
 */
type HostMethod = "execSqlPaged" | "fetchSqlRows";

/**
 * Logique de l'hôte des drivers, indépendante du transport.
 *
 * Tourne dans un utilityProcess : les clients de bases (et le module natif
 * SQLite, synchrone) n'occupent plus le thread principal d'Electron, et un
 * driver qui plante ou se bloque n'emporte pas l'application avec lui.
 */
export class DriverHost {
    private driver: DatabaseDriver;

    /**
     * Résultats SQL conservés pour la lecture par pages, du plus ancien au plus
     * récent (ordre d'insertion d'une `Map`).
     */
    private readonly results = new Map<string, unknown[][]>();

    public constructor(private readonly createDriver: (type: DatabaseDriverType) => DatabaseDriver) {
        this.driver = createDriver("sqlite");
    }

    /**
     * Traite une requête et produit la réponse à renvoyer au main.
     */
    public async handle(request: DriverHostRequest): Promise<DriverHostResponse> {
        try {
            const result = request.kind === "init"
                ? await this.init(request.driverType)
                : await this.call(request.method, request.args);

            return { id: request.id, ok: true, result, state: this.state };
        }
        catch (error) {
            return {
                id: request.id,
                ok: false,
                error: error instanceof Error ? error.message : String(error),
                state: this.state,
            };
        }
    }

    /**
     * Ferme le driver actif, par exemple avant l'arrêt du process.
     */
    public async dispose(): Promise<void> {
        this.results.clear();

        if (this.driver.isOpen) {
            await this.driver.close();
        }
    }

    private get state(): DriverHostState {
        return {
            isOpen: this.driver.isOpen,
            isInTransaction: this.driver.isInTransaction,
            path: this.driver.path,
        };
    }

    /**
     * Remplace le driver actif par un driver du type demandé.
     */
    private async init(type: DatabaseDriverType): Promise<void> {
        await this.dispose();
        this.driver = this.createDriver(type);
    }

    private async call(method: string, args: unknown[]): Promise<unknown> {
        switch (method as HostMethod) {
            case "execSqlPaged":
                return await this.execSqlPaged(args[0] as string);

            case "fetchSqlRows":
                return this.fetchSqlRows(args[0] as string, args[1] as number, args[2] as number);
        }

        // Seules les méthodes publiques du driver sont appelables : ni le
        // constructeur, ni un membre qui ne serait pas une fonction.
        const target = (this.driver as unknown as Record<string, unknown>)[method];

        if (method === "constructor" || method.startsWith("_") || typeof target !== "function") {
            throw new Error(`Unknown driver method: ${method}`);
        }

        const result = await (target as (...params: unknown[]) => unknown).apply(this.driver, args);

        // Une fermeture ou un changement de base invalide les résultats en cache.
        if (method === "close" || method === "open") {
            this.results.clear();
        }

        return result;
    }

    /**
     * Exécute une requête et ne renvoie que sa première page.
     *
     * Le reste du résultat reste dans l'hôte : un SELECT de 100 000 lignes ne
     * traverse plus l'IPC en un seul message, et le renderer ne matérialise que
     * ce que l'utilisateur fait défiler.
     */
    private async execSqlPaged(sql: string): Promise<R_SqlExecResponse> {
        const result = await this.driver.execSql(sql, SQL_MAX_RESULT_ROWS);

        if (!result.isSelect) {
            return { ...result, totalRows: 0, resultId: null, truncated: false };
        }

        const truncated = result.truncated === true || result.rows.length > SQL_MAX_RESULT_ROWS;
        const rows = result.rows.length > SQL_MAX_RESULT_ROWS ? result.rows.slice(0, SQL_MAX_RESULT_ROWS) : result.rows;

        let resultId: string | null = null;

        if (rows.length > SQL_FIRST_PAGE_SIZE) {
            resultId = randomUUID();
            this.remember(resultId, rows);
        }

        return {
            ...result,
            rows: rows.slice(0, SQL_FIRST_PAGE_SIZE),
            totalRows: rows.length,
            resultId,
            truncated,
        };
    }

    /**
     * Lit une page d'un résultat conservé.
     */
    private fetchSqlRows(resultId: string, offset: number, limit: number): { rows: unknown[][] } {
        const rows = this.results.get(resultId);

        if (!rows) {
            throw new Error("This query result is no longer available: run the query again.");
        }

        return { rows: rows.slice(Math.max(0, offset), Math.max(0, offset) + Math.max(0, limit)) };
    }

    private remember(resultId: string, rows: unknown[][]): void {
        this.results.set(resultId, rows);

        while (this.results.size > MAX_CACHED_RESULTS) {
            const oldest = this.results.keys().next().value;

            if (oldest === undefined) {
                break;
            }

            this.results.delete(oldest);
        }
    }
}
