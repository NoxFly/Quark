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

import type { AzureAuthMode } from "@shared/connection";
import type { DatabaseDriverType, DriverConnectionOptions } from "@shared/driver";

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
    /** URI complète (MongoDB), prioritaire sur l'hôte et les identifiants. */
    uri?: string;
    ssl?: boolean;
    timeoutSeconds?: number;
}

/**
 * Ce qu'il faut à un driver pour se connecter : son type, l'argument de `open`
 * et les options à lui passer avant. Construit dans le main, consommé tel quel
 * par l'hôte des drivers (ouverture de la fenêtre comme test de connexion).
 */
export interface DriverConnectionTarget {
    driverType: DatabaseDriverType;
    /** Argument de `open` : URI `user:password@host:port/database`, ou URL libSQL. */
    location: string;
    options: DriverConnectionOptions;
}
