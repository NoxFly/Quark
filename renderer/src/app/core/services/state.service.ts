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

import { computed, Injectable, signal } from "@angular/core";
import type { DatabaseSchema } from "@shared/types";
import type { DatabaseDriverType, DriverCapabilities, DriverInfo } from "@shared/driver";

@Injectable({ providedIn: "root" })
export class StateService {
    public readonly connected = signal<boolean>(false);
    public readonly database = signal<DatabaseSchema | null>(null);
    public readonly filePath = signal<string | null>(null);
    public readonly needsPassword = signal<boolean>(false);
    public readonly pendingFilePath = signal<string | null>(null);
    public readonly title = signal<string>("");
    public readonly appName = signal<string>("");
    public readonly appVersion = signal<string>("");
    public readonly fileName = signal<string>("");

    /** Type du driver actif (null si pas connecté). */
    public readonly driverType = signal<DatabaseDriverType | null>(null);

    /** Informations complètes du driver actif. */
    public readonly driverInfo = signal<DriverInfo | null>(null);

    /** Nom affiché du driver actif. */
    public readonly driverDisplayName = computed(() => this.driverInfo()?.displayName ?? null);

    /** Indique si la base courante est SQL. */
    public readonly isSqlDatabase = computed(() => this.driverInfo()?.category === "sql");

    /** Indique si la base courante est NoSQL. */
    public readonly isNoSqlDatabase = computed(() => this.driverInfo()?.category === "nosql");

    /** Capacités du driver actif (null si pas connecté). */
    public readonly capabilities = computed<DriverCapabilities | null>(() => this.driverInfo()?.capabilities ?? null);

    /** Indique si le schéma est en cours de chargement en arrière-plan (post-connexion réseau). */
    public readonly schemaLoading = signal<boolean>(false);
}
