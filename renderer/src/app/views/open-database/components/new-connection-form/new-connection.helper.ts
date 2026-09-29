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

import type { ConnectionProfileInput } from "@shared/connection";
import type { R_NetworkConnectBody, R_RemoteSqliteBody, R_TestConnectionBody } from "@shared/types";
import type { DriverPresentation } from "src/app/core/models/driver-presentation.model";
import type { NewConnectionDraft } from "src/app/core/models/new-connection.model";
import { describeConnectionUri } from "src/app/shared/helpers/connection-uri.helper";

/**
 * @description Brouillon vierge pour un type de base : port par défaut du driver
 * et SSL / TLS selon le réglage « SSL / TLS par défaut ».
 * @param defaultPort Port par défaut du type de base (`null` : sans objet).
 * @param sslByDefault Réglage `SettingsService.settings().sslByDefault`.
 * @returns Brouillon initial.
 */
export function createDraft(defaultPort: number | null, sslByDefault: boolean): NewConnectionDraft {
    return {
        sqliteMode: "file",
        filePath: "",
        url: "",
        authToken: "",
        uri: "",
        host: "localhost",
        port: defaultPort ?? 0,
        username: "",
        password: "",
        database: "",
        ssl: sslByDefault,
        authMode: "sql",
        clientId: "",
        tenantId: "",
    };
}

/**
 * @description Indique si le principal de service Entra ID est utilisé (Azure SQL uniquement).
 */
export function usesServicePrincipal(driver: DriverPresentation, draft: NewConnectionDraft): boolean {
    return driver.type === "azure" && draft.authMode === "service-principal";
}

/**
 * @description Vérifie que les champs obligatoires du formulaire affiché sont renseignés.
 * @returns `true` si « Tester » et « Se connecter » peuvent être proposés.
 */
export function isDraftComplete(driver: DriverPresentation, draft: NewConnectionDraft): boolean {
    if (driver.form === "file") {
        const source = draft.sqliteMode === "url" ? draft.url : draft.filePath;
        return source.trim().length > 0;
    }

    if (driver.form === "uri") {
        return draft.uri.trim().length > 0;
    }

    const hasServer = draft.host.trim().length > 0 && draft.database.trim().length > 0;

    if (!usesServicePrincipal(driver, draft)) {
        return hasServer;
    }

    return hasServer && draft.clientId.trim().length > 0 && draft.tenantId.trim().length > 0 && draft.password.length > 0;
}

/**
 * @description Corps d'une connexion réseau (serveur ou URI MongoDB).
 * @param timeoutSeconds Réglage « Délai de connexion ».
 */
export function buildNetworkBody(
    driver: DriverPresentation,
    draft: NewConnectionDraft,
    timeoutSeconds: number,
): R_NetworkConnectBody {
    if (driver.form === "uri") {
        return {
            driverType: driver.type,
            host: "",
            port: 0,
            username: "",
            password: "",
            database: "",
            uri: draft.uri.trim(),
            timeoutSeconds,
        };
    }

    const servicePrincipal = usesServicePrincipal(driver, draft);
    const isAzure = driver.type === "azure";

    return {
        driverType: driver.type,
        host: draft.host.trim(),
        port: draft.port,
        username: servicePrincipal ? "" : draft.username,
        password: draft.password,
        database: draft.database.trim(),
        authMode: isAzure ? draft.authMode : undefined,
        clientId: servicePrincipal ? draft.clientId.trim() : undefined,
        tenantId: servicePrincipal ? draft.tenantId.trim() : undefined,
        ssl: draft.ssl,
        timeoutSeconds,
    };
}

/**
 * @description Corps d'ouverture d'une base SQLite distante (libSQL / Turso).
 */
export function buildRemoteSqliteBody(draft: NewConnectionDraft, timeoutSeconds: number): R_RemoteSqliteBody {
    const authToken = draft.authToken.length > 0 ? draft.authToken : undefined;
    return { url: draft.url.trim(), authToken, timeoutSeconds };
}

/**
 * @description Cible du bouton « Tester » pour le formulaire affiché.
 */
export function buildTestBody(
    driver: DriverPresentation,
    draft: NewConnectionDraft,
    timeoutSeconds: number,
): R_TestConnectionBody {
    if (driver.form !== "file") {
        return { kind: "network", ...buildNetworkBody(driver, draft, timeoutSeconds) };
    }

    if (draft.sqliteMode === "url") {
        return { kind: "remote-sqlite", ...buildRemoteSqliteBody(draft, timeoutSeconds) };
    }

    return { kind: "file", filePath: draft.filePath.trim() };
}

/**
 * @description Nom proposé pour le profil créé par « Enregistrer dans le gestionnaire » :
 * nom du fichier, de la base distante ou de la base serveur.
 * @example profileNameFor(sqlite, { ...draft, filePath: "C:\\Données\\boutique.db" }); // "boutique.db"
 */
export function profileNameFor(driver: DriverPresentation, draft: NewConnectionDraft): string {
    if (driver.form === "file") {
        if (draft.sqliteMode === "url") {
            return describeConnectionUri(draft.url, driver.label).database;
        }

        const segments = draft.filePath.trim().split(/[\\/]/);
        return segments.at(-1) || driver.label;
    }

    if (driver.form === "uri") {
        return describeConnectionUri(draft.uri, driver.label).database;
    }

    const database = draft.database.trim();
    return database ? `${database} (${draft.host.trim()})` : driver.label;
}

/**
 * @description Profil à créer dans le gestionnaire de connexions à partir du formulaire.
 * Une base SQLite distante devient un profil `libsql` en mode `url` (jeton dans `password`),
 * comme le crée le gestionnaire de connexions.
 */
export function buildProfileInput(driver: DriverPresentation, draft: NewConnectionDraft): ConnectionProfileInput {
    const name = profileNameFor(driver, draft);

    if (driver.form === "file") {
        if (draft.sqliteMode === "url") {
            return {
                name,
                driverType: "libsql",
                connectionType: "network",
                sqliteMode: "url",
                url: draft.url.trim(),
                password: draft.authToken,
            };
        }

        return {
            name,
            driverType: "sqlite",
            connectionType: "file",
            sqliteMode: "file",
            filePath: draft.filePath.trim(),
        };
    }

    if (driver.form === "uri") {
        return { name, driverType: driver.type, connectionType: "network", uri: draft.uri.trim() };
    }

    const body = buildNetworkBody(driver, draft, 0);

    return {
        name,
        driverType: driver.type,
        connectionType: "network",
        host: body.host,
        port: body.port,
        username: body.username,
        database: body.database,
        authMode: body.authMode,
        clientId: body.clientId,
        tenantId: body.tenantId,
        ssl: body.ssl,
        password: draft.password,
    };
}
