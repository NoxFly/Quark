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

import { defineRoutes } from "@noxfly/noxus/main";

export const routes = defineRoutes([
    {
        path: "app",
        load: () => import("./app/app.controller"),
    },
    {
        path: "window",
        load: () => import("./window/window.controller"),
    },
    {
        path: "db",
        load: () => import("./db/db.controller"),
    },
    {
        path: "connections",
        load: () => import("./connections/connections.controller"),
    },
    {
        path: "update",
        load: () => import("./updater/updater.controller"),
    },
    {
        path: "session-diff",
        load: () => import("./session-diff/session-diff.controller"),
    },
    {
        path: "share",
        load: () => import("./share/share.controller"),
    },
]);
