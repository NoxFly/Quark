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
import type { ConnectionTestResult } from "@shared/connection";
import type { DatabaseDriverType, DriverConnectionOptions } from "@shared/driver";
import type { R_SqlExecResponse } from "@shared/types";
import { describeConnectionError, toTimeoutMs, withDeadline } from "src/core/drivers/connection-target.helper";
import type { DriverConnectionTarget } from "src/core/drivers/connection-target.types";
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

/** Échéance d'un test de connexion sans délai configuré. */
const DEFAULT_TEST_TIMEOUT_MS = 15_000;

/**
 * Méthodes de l'hôte lui-même, prioritaires sur celles du driver.
 * Toute autre méthode est cherchée sur le driver actif.
 */
type HostMethod = "execSqlPaged" | "fetchSqlRows" | "testConnection";

/** Crée un driver du type demandé ; son module n'est chargé qu'à ce moment. */
export type DriverFactory = (type: DatabaseDriverType) => Promise<DatabaseDriver>;

const CLOSED_STATE: DriverHostState = { isOpen: false, isInTransaction: false, path: null };

/**
 * Logique de l'hôte des drivers, indépendante du transport.
 *
 * Tourne dans un utilityProcess : les clients de bases (et le module natif
 * SQLite, synchrone) n'occupent plus le thread principal d'Electron, et un
 * driver qui plante ou se bloque n'emporte pas l'application avec lui.
 */
export class DriverHost {
    /** Driver actif, `null` tant que le premier n'est pas encore chargé. */
    private driver: DatabaseDriver | null = null;

    /**
     * Driver sur lequel exécuter le prochain appel. Un changement de driver
     * remplace cette promesse : un appel reçu juste après un `init` attend le
     * nouveau driver au lieu de partir sur l'ancien, même si son chargement est
     * long.
     */
    private ready: Promise<DatabaseDriver>;

    /**
     * Résultats SQL conservés pour la lecture par pages, du plus ancien au plus
     * récent (ordre d'insertion d'une `Map`).
     */
    private readonly results = new Map<string, unknown[][]>();

    /**
     * @param createDriver - Fabrique des drivers.
     * @param onConfidentialChange - Prévenu quand une connexion confidentielle
     * (partagée) commence ou s'achève, pour suspendre le journal du process.
     */
    public constructor(
        private readonly createDriver: DriverFactory,
        private readonly onConfidentialChange?: (confidential: boolean) => void,
    ) {
        this.ready = this.activate(createDriver("sqlite"));
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
        await this.release(await this.ready);
    }

    private get state(): DriverHostState {
        if (!this.driver) {
            return CLOSED_STATE;
        }

        return {
            isOpen: this.driver.isOpen,
            isInTransaction: this.driver.isInTransaction,
            path: this.driver.path,
        };
    }

    /**
     * Remplace le driver actif par un driver du type demandé.
     * Un type inconnu laisse l'ancien driver en place, fermé.
     */
    private async init(type: DatabaseDriverType): Promise<void> {
        // Un nouveau driver sert une nouvelle connexion : confidentielle seulement
        // si ses options le disent.
        this.onConfidentialChange?.(false);

        const previous = this.ready;
        const next = this.activate(previous.then(async driver => {
            await this.release(driver);
            return await this.createDriver(type);
        }));

        this.ready = next.catch(() => previous);
        await next;
    }

    /**
     * Fait d'un driver en cours de création le driver actif, dès qu'il existe.
     */
    private async activate(creating: Promise<DatabaseDriver>): Promise<DatabaseDriver> {
        const driver = await creating;
        this.driver = driver;

        return driver;
    }

    /**
     * Ferme un driver et oublie les résultats SQL qu'il a produits.
     */
    private async release(driver: DatabaseDriver): Promise<void> {
        this.results.clear();

        if (driver.isOpen) {
            await driver.close();
        }
    }

    private async call(method: string, args: unknown[]): Promise<unknown> {
        const driver = await this.ready;

        switch (method as HostMethod) {
            case "execSqlPaged":
                return await this.execSqlPaged(driver, args[0] as string);

            case "fetchSqlRows":
                return this.fetchSqlRows(args[0] as string, args[1] as number, args[2] as number);

            case "testConnection":
                return await this.testConnection(args[0] as DriverConnectionTarget);
        }

        if (method === "configureConnection") {
            this.onConfidentialChange?.((args[0] as DriverConnectionOptions | undefined)?.confidential === true);
        }

        // Seules les méthodes publiques du driver sont appelables : ni le
        // constructeur, ni un membre qui ne serait pas une fonction.
        const target = (driver as unknown as Record<string, unknown>)[method];

        if (method === "constructor" || method.startsWith("_") || typeof target !== "function") {
            throw new Error(`Unknown driver method: ${method}`);
        }

        const result = await (target as (...params: unknown[]) => unknown).apply(driver, args);

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
    private async execSqlPaged(driver: DatabaseDriver, sql: string): Promise<R_SqlExecResponse> {
        const result = await driver.execSql(sql, SQL_MAX_RESULT_ROWS);

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
     * Ouvre une connexion éphémère sur un driver dédié, mesure le temps
     * d'établissement puis la referme. Le driver de la fenêtre n'est pas touché :
     * tester un profil ne ferme pas la base en cours.
     *
     * Une ouverture qui dépasse l'échéance continue en arrière-plan ; la connexion
     * qu'elle finirait par établir est refermée dès qu'elle aboutit.
     */
    private async testConnection(target: DriverConnectionTarget): Promise<ConnectionTestResult> {
        const driver = await this.createDriver(target.driverType);
        const timeoutMs = toTimeoutMs(target.options.timeoutSeconds) ?? DEFAULT_TEST_TIMEOUT_MS;
        const startedAt = performance.now();
        let opening: Promise<boolean> | null = null;

        try {
            await driver.configureConnection(target.options);
            opening = driver.open(target.location);
            await withDeadline(opening, timeoutMs, `Connection timed out after ${Math.round(timeoutMs / 1000)}s`);

            return { ok: true, latencyMs: Math.round(performance.now() - startedAt) };
        }
        catch (error) {
            return { ok: false, error: describeConnectionError(error) };
        }
        finally {
            void (opening ?? Promise.resolve(false))
                .then(() => driver.close(), () => undefined)
                .catch(() => undefined);
        }
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
