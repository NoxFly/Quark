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

import { Routes } from "@angular/router";

export const routes: Routes = [
    {
        path: "not-desktop",
        loadComponent: () => import("./views/not-desktop/not-desktop.page").then((c) => c.NotDesktopPage),
    },
    {
        path: "dashboard",
        loadChildren: () => import("./views/dashboard/dashboard.routes").then((c) => c.routes),
    },
    {
        path: "open-database",
        loadComponent: () => import("./views/open-database/open-database.page").then((c) => c.OpenDatabasePage),
    },
    { path: "", redirectTo: "dashboard", pathMatch: "full" },
    { path: "**", redirectTo: "dashboard", pathMatch: "full" },
];
