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

import type { R_ShareCreateBody } from "@shared/share";
import { buildNetworkTarget, buildRemoteSqliteTarget } from "src/core/drivers/connection-target.helper";
import type { DriverConnectionTarget } from "src/core/drivers/connection-target.types";
import type { StoredConnectionProfile } from "src/core/services/connection-store.types";

/**
 * Cible de connexion d'un partage : celle du profil, avec l'utilisateur et le
 * secret saisis pour ce partage s'il y en a.
 * @throws Si le profil n'est pas une base distante.
 */
export function shareTarget(profile: StoredConnectionProfile, body: Pick<R_ShareCreateBody, "username" | "secret">): DriverConnectionTarget {
    const secret = body.secret ?? profile.password ?? "";

    if (profile.driverType === "libsql" || (profile.driverType === "sqlite" && profile.sqliteMode === "url")) {
        return buildRemoteSqliteTarget({ url: profile.url ?? "", authToken: secret || undefined });
    }

    if (profile.connectionType !== "network") {
        throw new Error("Only a remote database can be shared");
    }

    return buildNetworkTarget({
        driverType: profile.driverType,
        host: profile.host ?? "localhost",
        port: profile.port ?? 0,
        username: body.username ?? profile.username ?? "",
        password: secret,
        database: profile.database ?? "",
        authMode: profile.authMode,
        clientId: profile.clientId,
        tenantId: profile.tenantId,
        uri: profile.uri,
        ssl: profile.ssl,
    });
}

/**
 * Informations d'une cible à ne jamais montrer au destinataire d'un partage :
 * adresse complète, hôtes, utilisateur, secret, base et identifiants Azure.
 */
export function connectionSecrets(target: DriverConnectionTarget): string[] {
    const values = [target.location, target.options.uri, target.options.authToken, target.options.azureAuth?.clientId, target.options.azureAuth?.tenantId];

    for (const address of [target.location, target.options.uri]) {
        values.push(...addressParts(address));
    }

    return values.filter((value): value is string => typeof value === "string" && value.length > 0);
}

/**
 * Découpe une adresse `[scheme://][user[:password]@]host[:port][,host2…][/database]`.
 */
function addressParts(address: string | undefined): string[] {
    const match = address ? /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:([^:@/]*)(?::([^@/]*))?@)?([^/?#]+)(?:\/([^?#]*))?/i.exec(address) : null;

    if (!match) {
        return [];
    }

    const [, user, password, hosts, database] = match;
    const parts = [user, password, hosts, database].filter((part): part is string => !!part).map(safeDecode);

    // Chaque hôte d'une liste (réplicas MongoDB), avec et sans son port.
    for (const host of hosts?.split(",") ?? []) {
        parts.push(host, host.replace(/:\d+$/, ""));
    }

    return parts;
}

function safeDecode(value: string): string {
    try {
        return decodeURIComponent(value);
    }
    catch {
        return value;
    }
}
