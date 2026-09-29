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

import { inject, Injectable } from "@noxfly/noxus/main";
import type { AzureAuthMode } from "@shared/connection";
import type { DatabaseDriverType } from "@shared/driver";
import type {
    R_AlterTableAction,
    R_CreateIndexBody,
    R_CreateTableBody,
    R_ImportDataBody,
    R_OpenFileResponse,
    R_SqlExecResponse,
} from "@shared/types";
import type { Window } from "src/core/services/window";
import { Application } from "src/modules/application";

/** Paramètres d'une connexion réseau, communs à la saisie manuelle et aux profils. */
export interface NetworkConnectionRequest {
    driverType: DatabaseDriverType;
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
    authMode?: AzureAuthMode;
    clientId?: string;
    tenantId?: string;
}

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

    /**
     * Ouvre un fichier SQLite dans la fenêtre, ou remonte la fenêtre qui l'a déjà ouvert.
     */
    public async openFile(window: Window, filePath: string): Promise<R_OpenFileResponse> {
        const existing = this.application.findWindowByFilePath(filePath);

        if (existing && existing.id !== window.id) {
            existing.focus();
            return { needsPassword: false, database: null, alreadyOpen: true };
        }

        const needsPassword = await window.openDatabase(filePath);

        // Toujours enregistré, marqué chiffré si un mot de passe est requis.
        this.application.rememberRecentFile(filePath, needsPassword);

        return {
            needsPassword,
            database: needsPassword ? null : await window.getDatabaseSchema(),
        };
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

        const needsPassword = await window.reopenDatabase(dbPath);

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
        // En mode service principal, aucun identifiant utilisateur n'existe : un
        // utilisateur fictif satisfait le format d'URI. Le secret (clientSecret)
        // reste porté par le champ `password`.
        const uriUser = params.authMode === "service-principal" ? "aad" : params.username;
        const uri = `${uriUser}:${params.password}@${params.host}:${params.port}/${params.database}`;

        await window.setDriverType(params.driverType);

        if (params.driverType === "azure" && params.authMode) {
            await window.database.configureAzureAuth({
                mode: params.authMode,
                clientId: params.clientId,
                tenantId: params.tenantId,
            });
        }

        await window.openDatabase(uri);

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
