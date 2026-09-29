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

import { inject, Injectable, type Request } from "@noxfly/noxus/main";
import type { AppState } from "@shared/types";
import { withTimeout } from "src/core/helpers/async.helper";
import { Application } from "src/modules/application";

/**
 * Échéance de lecture du schéma pendant l'initialisation du renderer.
 *
 * Le renderer reste masqué derrière son écran de chargement tant que cette
 * requête n'a pas répondu : un driver bloqué (serveur injoignable, fichier sur
 * un partage réseau coupé) produirait sinon une fenêtre blanche définitive,
 * identique après un rechargement puisque la connexion vit dans le main.
 */
const SCHEMA_LOAD_TIMEOUT_MS = 10_000;

@Injectable()
export class AppService {
    private readonly application = inject(Application);

    /**
     * Retourne l'état courant de la fenêtre associée au sender.
     */
    public async getState(request: Request): Promise<AppState> {
        const window = this.application.getWindowBySenderId(request.senderId);

        if (!window) {
            return {
                connected: false,
                database: null,
                filePath: null,
                driverType: null,
                driverInfo: null,
            };
        }

        const isOpen = window.database.isOpen;
        const schema = isOpen
            ? await withTimeout(window.getDatabaseSchema(), SCHEMA_LOAD_TIMEOUT_MS, null, "app/state getSchema")
            : null;

        return {
            connected: isOpen,
            database: schema,
            filePath: window.database.path,
            driverType: window.database.driverType,
            driverInfo: window.database.info,
        };
    }
}
