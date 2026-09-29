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

import { inject, Injectable, Logger } from "@noxfly/noxus/main";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import type { ConnectionTestResult } from "@shared/connection";
import type {
    DatabaseSchema,
    R_AlterTableAction,
    R_CreateIndexBody,
    R_CreateTableBody,
    R_ImportDataBody,
    R_OpenFileResponse,
    R_RemoteSqliteBody,
    R_SqlExecResponse,
    R_TestConnectionBody,
} from "@shared/types";
import {
    buildNetworkTarget,
    buildRemoteSqliteTarget,
    describeConnectionError,
} from "src/core/drivers/connection-target.helper";
import type { DriverConnectionTarget, NetworkConnectionRequest } from "src/core/drivers/connection-target.types";
import { RememberedPasswords } from "src/core/services/remembered-passwords";
import type { Window } from "src/core/services/window";
import { Application } from "src/modules/application";

/**
 * Décrit une modification de schéma pour le journal de session.
 * Le secret d'une éventuelle valeur par défaut n'y figure pas : seule la
 * structure est journalisée.
 */
function describeAlterTable(action: R_AlterTableAction): string {
    switch (action.action) {
        case "rename-table":
            return `RENAME TO ${action.newName}`;
        case "add-column":
            return `ADD COLUMN ${action.column.name} ${action.column.type}`;
        case "rename-column":
            return `RENAME COLUMN ${action.column} TO ${action.newName}`;
        case "drop-column":
            return `DROP COLUMN ${action.column}`;
    }
}

/**
 * Opérations sur la base de la fenêtre appelante qui dépassent le simple relais
 * au driver : historique des bases récentes et journal du diff de session.
 */
@Injectable({ lifetime: "singleton" })
export class DbService {
    private readonly application = inject(Application);
    private readonly passwords = new RememberedPasswords();

    /**
     * Ouvre un fichier SQLite dans la fenêtre, ou remonte la fenêtre qui l'a déjà ouvert.
     */
    public async openFile(window: Window, filePath: string): Promise<R_OpenFileResponse> {
        const existing = this.application.findWindowByFilePath(filePath);

        if (existing && existing.id !== window.id) {
            existing.focus();
            return { needsPassword: false, database: null, alreadyOpen: true };
        }

        // Un driver réseau actif lirait le chemin comme une URI.
        if (window.database.driverType !== "sqlite") {
            await window.setDriverType("sqlite");
        }

        const encrypted = await window.openDatabase(filePath);
        const needsPassword = encrypted && !(await this.tryRememberedPassword(window, filePath));

        // Toujours enregistré, marqué chiffré si un mot de passe est requis.
        this.application.rememberRecentFile(filePath, encrypted);

        return {
            needsPassword,
            database: needsPassword ? null : await window.getDatabaseSchema(),
        };
    }

    /**
     * Déverrouille la base chiffrée ouverte dans la fenêtre, et mémorise le mot
     * de passe dans le trousseau du système si l'utilisateur l'a demandé.
     */
    public async submitPassword(window: Window, password: string, remember: boolean): Promise<DatabaseSchema | null> {
        await window.unlockDatabase(password);

        const filePath = window.database.path;

        if (remember && filePath && !this.passwords.remember(filePath, password)) {
            Logger.warn("System keychain unavailable: the database password was not remembered.");
        }

        return await window.getDatabaseSchema();
    }

    /**
     * Essaie le mot de passe mémorisé d'un fichier chiffré déjà ouvert (en attente
     * de déverrouillage). Un mot de passe refusé est oublié : la base a changé de
     * mot de passe, l'utilisateur doit le ressaisir.
     * @returns `true` si la base est déverrouillée.
     */
    public async tryRememberedPassword(window: Window, filePath: string): Promise<boolean> {
        const password = this.passwords.get(filePath);

        if (password === null) {
            return false;
        }

        try {
            await window.unlockDatabase(password);
            return true;
        }
        catch {
            Logger.info("Remembered database password was rejected: forgetting it.");
            this.passwords.forget(filePath);
            return false;
        }
    }

    /**
     * Change le mot de passe de la base ouverte. Un mot de passe mémorisé suit le
     * changement, plutôt que d'échouer à la prochaine ouverture.
     */
    public async changePassword(window: Window, newPassword: string | null): Promise<void> {
        await window.database.changePassword(newPassword);

        const filePath = window.database.path;

        if (!filePath || !this.passwords.has(filePath)) {
            return;
        }

        if (newPassword) {
            this.passwords.remember(filePath, newPassword);
        }
        else {
            this.passwords.forget(filePath);
        }
    }

    /**
     * Ferme puis rouvre la base courante. Le diff de session est préservé : un
     * rafraîchissement relit la base, il ne recommence pas la session.
     */
    public async refresh(window: Window): Promise<R_OpenFileResponse> {
        const dbPath = window.database.path;

        if (!dbPath) {
            return { needsPassword: false, database: null };
        }

        const encrypted = await window.reopenDatabase(dbPath);
        const needsPassword = encrypted && !(await this.tryRememberedPassword(window, dbPath));

        return {
            needsPassword,
            database: needsPassword ? null : await window.getDatabaseSchema(),
        };
    }

    /**
     * Ouvre une connexion réseau et l'enregistre dans l'historique (sans le mot
     * de passe). Partagé entre la connexion manuelle et les profils sauvegardés.
     */
    public async openNetworkConnection(window: Window, params: NetworkConnectionRequest): Promise<void> {
        await this.openTarget(window, buildNetworkTarget(params));

        this.application.rememberRecentNetwork({
            driverType: params.driverType,
            host: params.host,
            port: params.port,
            username: params.username,
            database: params.database,
            hasEmptyPassword: params.password.length === 0,
        });
    }

    /**
     * Ouvre une base SQLite distante (libSQL / Turso) et l'enregistre dans
     * l'historique, sans son jeton.
     */
    public async openRemoteSqlite(window: Window, body: R_RemoteSqliteBody): Promise<void> {
        const target = buildRemoteSqliteTarget(body);

        await this.openTarget(window, target);

        this.application.rememberRecentRemote(target.location, target.options.authToken !== undefined);
    }

    /**
     * Teste une connexion sans toucher à celle de la fenêtre. Les connexions
     * réseau sont testées dans l'hôte des drivers (les clients n'existent que là) ;
     * un fichier local n'est que vérifié : existence, nature et lisibilité.
     */
    public async testConnection(window: Window, body: R_TestConnectionBody): Promise<ConnectionTestResult> {
        if (body.kind === "file") {
            return await this.testFile(body.filePath);
        }

        let target: DriverConnectionTarget;

        try {
            target = body.kind === "remote-sqlite" ? buildRemoteSqliteTarget(body) : buildNetworkTarget(body);
        }
        catch (error) {
            return { ok: false, error: describeConnectionError(error) };
        }

        return await window.database.testConnection(target);
    }

    /**
     * Vide une table ; la fenêtre journalise l'opération dans le diff de session.
     * @returns Le nombre de lignes supprimées.
     */
    public async truncateTable(window: Window, table: string): Promise<number> {
        return await window.truncateTable(table);
    }

    /**
     * Change de driver, lui passe ses options puis ouvre la cible. Le changement
     * de driver remet le diff de session à zéro : c'est une nouvelle connexion.
     */
    private async openTarget(window: Window, target: DriverConnectionTarget): Promise<void> {
        await window.setDriverType(target.driverType);
        await window.database.configureConnection(target.options);
        await window.openDatabase(target.location);
    }

    private async testFile(filePath: string): Promise<ConnectionTestResult> {
        const startedAt = performance.now();

        try {
            const info = await stat(filePath);

            if (!info.isFile()) {
                return { ok: false, error: "This path is not a file." };
            }

            await access(filePath, constants.R_OK);

            return { ok: true, latencyMs: Math.round(performance.now() - startedAt) };
        }
        catch (error) {
            const code = (error as NodeJS.ErrnoException).code;

            if (code === "ENOENT") {
                return { ok: false, error: "File not found." };
            }

            if (code === "EACCES" || code === "EPERM") {
                return { ok: false, error: "The file cannot be read: access denied." };
            }

            return { ok: false, error: describeConnectionError(error) };
        }
    }

    /**
     * Exécute du SQL brut depuis l'éditeur. Seule la première page d'un SELECT
     * est renvoyée ; le reste se lit par `fetchSqlRows`.
     */
    public async execSql(window: Window, sql: string): Promise<R_SqlExecResponse> {
        const result = await window.database.execSqlPaged(sql);

        // Le SQL brut n'est pas diffé ligne à ligne : il faudrait snapshoter la
        // table ciblée avant et après, à un coût proportionnel à sa taille.
        if (!result.isSelect) {
            window.recordOpaqueChange({
                category: "sql",
                label: "SQL statement executed",
                detail: sql,
                rowsAffected: result.rowsAffected,
            });
        }

        return result;
    }

    public async importData(window: Window, body: R_ImportDataBody): Promise<void> {
        await window.database.importData(body.table, body.format, body.data, body.mode);

        window.recordOpaqueChange({
            category: "import",
            label: `Data imported into ${body.table}`,
            detail: `${body.format.toUpperCase()} import, mode "${body.mode}"`,
            table: body.table,
        });
    }

    public async createIndex(window: Window, body: R_CreateIndexBody): Promise<void> {
        await window.database.createIndex(body.table, body.name, body.columns, body.unique);

        window.recordOpaqueChange({
            category: "schema",
            label: `Index ${body.name} created`,
            detail: `${body.unique ? "UNIQUE " : ""}INDEX on ${body.table} (${body.columns.join(", ")})`,
            table: body.table,
        });
    }

    public async dropIndex(window: Window, name: string): Promise<void> {
        await window.database.dropIndex(name);

        window.recordOpaqueChange({
            category: "schema",
            label: `Index ${name} dropped`,
            detail: `DROP INDEX ${name}`,
        });
    }

    public async createTable(window: Window, body: R_CreateTableBody): Promise<void> {
        await window.database.createTable(body.name, body.columns, body.ifNotExists);

        window.recordOpaqueChange({
            category: "schema",
            label: `Table ${body.name} created`,
            detail: body.columns.map(column => `${column.name} ${column.type}`).join(", "),
            table: body.name,
        });
    }

    public async alterTable(window: Window, action: R_AlterTableAction): Promise<void> {
        await window.database.alterTable(action);

        window.recordOpaqueChange({
            category: "schema",
            label: `Table ${action.table} altered`,
            detail: describeAlterTable(action),
            table: action.table,
        });
    }

    public async dropTable(window: Window, table: string): Promise<void> {
        await window.database.dropTable(table);

        window.recordOpaqueChange({
            category: "schema",
            label: `Table ${table} dropped`,
            detail: `DROP TABLE ${table}`,
            table,
        });
    }
}
