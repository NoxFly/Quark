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

// Ce module est chargé par le main ET par l'hôte des drivers : il ne doit importer
// ni Electron ni `@noxfly/noxus/main`.

import type { DriverConnectionOptions } from "@shared/driver";
import type { R_RemoteSqliteBody } from "@shared/types";
import type { DriverConnectionTarget, NetworkConnectionRequest } from "src/core/drivers/connection-target.types";

/** Base MongoDB utilisée quand ni le formulaire ni l'URI n'en désignent une (défaut du driver). */
const MONGO_DEFAULT_DATABASE = "test";

/** Schémas acceptés pour une base SQLite distante (client libSQL « web »). */
const REMOTE_SQLITE_SCHEMES = new Set(["libsql:", "https:", "http:", "wss:", "ws:"]);

/** Délai plafond accepté pour un établissement de connexion (10 min). */
const MAX_TIMEOUT_SECONDS = 600;

const MONGO_URI_PATTERN =
    /^(?<scheme>mongodb(?:\+srv)?):\/\/(?:(?<credentials>[^@/]*)@)?(?<hosts>[^/?]+)(?:\/(?<database>[^?]*))?(?:\?.*)?$/i;

/**
 * @description Convertit un délai saisi en secondes en millisecondes, en écartant
 * les valeurs absentes, nulles, négatives ou absurdes.
 * @param seconds - Délai en secondes.
 * @returns Le délai en millisecondes, ou `undefined` pour garder le défaut du driver.
 * @example toTimeoutMs(15) // 15000
 */
export function toTimeoutMs(seconds: number | undefined): number | undefined {
    if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
        return undefined;
    }

    const bounded = Math.min(seconds, MAX_TIMEOUT_SECONDS);

    return Math.round(bounded * 1000);
}

/**
 * @description Extrait d'une URI MongoDB les hôtes et le nom de base, sans les identifiants.
 * @param uri - URI `mongodb://` ou `mongodb+srv://`.
 * @returns Les hôtes et la base (`null` si l'URI n'en désigne pas), ou `null` si l'URI est invalide.
 * @example parseMongoUri("mongodb+srv://u:p@cluster.example.net/shop?retryWrites=true")
 * // { hosts: "cluster.example.net", database: "shop" }
 */
export function parseMongoUri(uri: string): { hosts: string; database: string | null } | null {
    const match = MONGO_URI_PATTERN.exec(uri.trim());
    const groups = match?.groups;

    if (!groups?.["hosts"]) {
        return null;
    }

    const rawDatabase = groups["database"] ?? "";
    const database = rawDatabase.length > 0 ? decodeURIComponent(rawDatabase) : null;

    return { hosts: groups["hosts"], database };
}

/**
 * @description Construit la cible de connexion d'une base réseau : l'URI lue par
 * `NetworkSqlDriver` / `MongodbDriver` et les options (SSL, délai, URI MongoDB,
 * authentification Azure).
 * @param params - Paramètres saisis ou issus d'un profil.
 * @returns La cible à ouvrir.
 * @throws Si l'URI MongoDB fournie est invalide.
 */
export function buildNetworkTarget(params: NetworkConnectionRequest): DriverConnectionTarget {
    const options: DriverConnectionOptions = {
        ssl: params.ssl,
        timeoutSeconds: params.timeoutSeconds,
    };

    if (params.driverType === "azure" && params.authMode) {
        options.azureAuth = { mode: params.authMode, clientId: params.clientId, tenantId: params.tenantId };
    }

    const mongoUri = params.driverType === "mongodb" ? params.uri?.trim() : undefined;

    if (mongoUri) {
        const parsed = parseMongoUri(mongoUri);

        if (!parsed) {
            throw new Error("Invalid MongoDB connection URI: expected mongodb:// or mongodb+srv://");
        }

        // Le `location` ne porte que les hôtes et la base : il devient le `path` du
        // driver (titre de fenêtre, journal), les identifiants de l'URI n'y ont pas leur place.
        const database = params.database || parsed.database || MONGO_DEFAULT_DATABASE;

        options.uri = mongoUri;

        return { driverType: params.driverType, location: `${parsed.hosts}/${database}`, options };
    }

    // En mode service principal, aucun identifiant utilisateur n'existe : un
    // utilisateur fictif satisfait le format d'URI. Le secret (clientSecret)
    // reste porté par le champ `password`.
    const user = params.authMode === "service-principal" ? "aad" : params.username;
    const location = `${user}:${params.password}@${params.host}:${params.port}/${params.database}`;

    return { driverType: params.driverType, location, options };
}

/**
 * @description Valide l'URL d'une base SQLite distante et construit sa cible.
 * @param body - URL, jeton et délai saisis.
 * @returns La cible `libsql` à ouvrir.
 * @throws Si l'URL est invalide ou d'un schéma non supporté.
 */
export function buildRemoteSqliteTarget(body: R_RemoteSqliteBody): DriverConnectionTarget {
    const { url, authToken: tokenFromUrl } = normalizeRemoteSqliteUrl(body.url);
    const authToken = body.authToken?.trim() || tokenFromUrl;

    return {
        driverType: "libsql",
        location: url,
        options: {
            authToken: authToken ? authToken : undefined,
            timeoutSeconds: body.timeoutSeconds,
        },
    };
}

/**
 * @description Vérifie qu'une URL désigne une base libSQL joignable par le client web,
 * et en retire un éventuel `?authToken=` : l'URL devient le `path` du driver, affiché
 * dans le titre et conservé dans l'historique, où un jeton n'a pas sa place.
 * @param url - URL saisie.
 * @returns L'URL nettoyée et le jeton qu'elle portait.
 * @throws Si l'URL est mal formée ou d'un schéma non supporté (`file:` notamment).
 * @example normalizeRemoteSqliteUrl("libsql://db.example.io?authToken=abc")
 * // { url: "libsql://db.example.io", authToken: "abc" }
 */
export function normalizeRemoteSqliteUrl(url: string): { url: string; authToken?: string } {
    const trimmed = url.trim();
    let parsed: URL;

    try {
        parsed = new URL(trimmed);
    }
    catch {
        throw new Error(`Invalid remote SQLite URL: "${trimmed}"`);
    }

    if (!REMOTE_SQLITE_SCHEMES.has(parsed.protocol)) {
        throw new Error("Unsupported remote SQLite URL: use libsql://, https://, http://, wss:// or ws://");
    }

    const authToken = parsed.searchParams.get("authToken");

    if (authToken === null) {
        return { url: trimmed };
    }

    parsed.searchParams.delete("authToken");

    const cleaned = parsed.toString().replace(/\?$/, "");

    return { url: cleaned, authToken: authToken || undefined };
}

/**
 * @description Borne une opération : au-delà du délai, la promesse retournée est
 * rejetée avec `message`. L'opération elle-même continue ; à l'appelant de
 * libérer ce qu'elle produira (une connexion établie trop tard, par exemple).
 * @param operation - Opération à borner.
 * @param timeoutMs - Délai en millisecondes.
 * @param message - Message de l'erreur d'échéance.
 * @returns Le résultat de l'opération.
 */
export async function withDeadline<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    });

    try {
        return await Promise.race([operation, deadline]);
    }
    finally {
        clearTimeout(timer);
    }
}

/** Profondeur maximale de la chaîne `cause` explorée. */
const MAX_CAUSE_DEPTH = 5;

/**
 * @description Concatène le message d'une erreur et ceux de ses causes. `fetch` ne
 * dit que « fetch failed » : la vraie raison (`ECONNREFUSED`, certificat…) est
 * dans `cause`.
 * @param error - Erreur à décrire.
 * @returns Les messages distincts de la chaîne, séparés par « : ».
 * @example errorChainMessage(new Error("fetch failed", { cause: new Error("connect ECONNREFUSED") }))
 * // "fetch failed: connect ECONNREFUSED"
 */
export function errorChainMessage(error: unknown): string {
    const parts: string[] = [];
    let current: unknown = error;

    for (let depth = 0; depth < MAX_CAUSE_DEPTH && current !== undefined && current !== null; depth++) {
        const message = current instanceof Error ? current.message : String(current);

        if (message && !parts.includes(message)) {
            parts.push(message);
        }

        current = current instanceof Error ? current.cause : undefined;
    }

    return parts.join(": ");
}

/**
 * Motifs d'erreurs réseau fréquentes, traduits en un message compréhensible.
 * Le message d'origine est conservé entre parenthèses : il reste le seul indice
 * exploitable quand la cause est inhabituelle.
 */
const CONNECTION_ERROR_HINTS: { pattern: RegExp; hint: string }[] = [
    { pattern: /ECONNREFUSED/i, hint: "Connection refused: no server is listening at this address and port." },
    { pattern: /ENOTFOUND|EAI_AGAIN|getaddrinfo/i, hint: "Host not found: check the server address." },
    { pattern: /ETIMEDOUT|timed out|timeout/i, hint: "The server did not respond in time." },
    { pattern: /ECONNRESET|socket hang up/i, hint: "The connection was closed by the server." },
    { pattern: /certificate|self[- ]signed|SSL|TLS/i, hint: "Secure connection (SSL/TLS) failed." },
    {
        pattern: /password authentication failed|Access denied|Login failed|authentication failed|ORA-01017|Unauthorized|\bHTTP 401\b/i,
        hint: "Authentication failed: check the username and password.",
    },
];

/**
 * @description Rend lisible une erreur d'établissement de connexion : retire les
 * préfixes empilés par les couches successives (« Failed to connect to mysql:
 * Error: … ») et ajoute une explication pour les causes réseau courantes.
 * @param error - Erreur levée par le driver.
 * @returns Message destiné à l'utilisateur.
 * @example describeConnectionError(new Error("connect ECONNREFUSED 127.0.0.1:5432"))
 * // "Connection refused: no server is listening at this address and port. (connect ECONNREFUSED 127.0.0.1:5432)"
 */
export function describeConnectionError(error: unknown): string {
    const raw = errorChainMessage(error);
    const cleaned = raw
        .replace(/^(?:Failed to (?:connect to|open) [\w\s-]+:\s*)+/i, "")
        .replace(/^(?:\w*Error:\s*)+/, "")
        .trim();
    const detail = cleaned.length > 0 ? cleaned : raw;
    const known = CONNECTION_ERROR_HINTS.find(entry => entry.pattern.test(detail));

    if (!known) {
        return detail;
    }

    return `${known.hint} (${detail})`;
}
