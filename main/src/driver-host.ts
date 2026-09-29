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

/**
 * Point d'entrée de l'utilityProcess qui héberge le driver d'une fenêtre.
 * Bundlé séparément du main (`dist/driver-host.js`).
 */

import { Logger } from "@noxfly/noxus";
import { DriverHost } from "src/core/driver-host/driver-host.service";
import { DRIVER_HOST_LOG_ARG, type DriverHostRequest } from "src/core/driver-host/driver-host.protocol";
import { createDriver } from "src/core/drivers/driver-factory";

const logFile = process.argv.find(arg => arg.startsWith(DRIVER_HOST_LOG_ARG))?.slice(DRIVER_HOST_LOG_ARG.length);

if (logFile) {
    Logger.enableFileLogging(logFile);
}

const host = new DriverHost(createDriver);
const port = process.parentPort;

port.on("message", event => {
    void host.handle(event.data as DriverHostRequest).then(response => {
        try {
            port.postMessage(response);
        }
        catch (error) {
            // Une valeur non clonable (fonction, objet natif du client) dans le
            // résultat ferait échouer l'envoi : le main attendrait indéfiniment.
            port.postMessage({
                id: response.id,
                ok: false,
                error: `Driver result could not be transferred: ${error instanceof Error ? error.message : String(error)}`,
                state: response.state,
            });
        }
    });
});

process.on("uncaughtException", error => {
    Logger.critical(`Driver host uncaught exception: ${error.stack ?? error.message}`);
});

process.on("unhandledRejection", reason => {
    Logger.critical(`Driver host unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`);
});
