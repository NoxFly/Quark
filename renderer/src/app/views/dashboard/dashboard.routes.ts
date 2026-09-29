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
        path: "no-table",
        loadComponent: () => import("./no-table/no-table.page").then((c) => c.NoTablePage),
    },
    {
        path: "table-data",
        loadComponent: () => import("./table-data/table-data.page").then((c) => c.TableDataPage),
    },
    {
        path: "sql-editor",
        loadComponent: () => import("./sql-editor/sql-editor.page").then((c) => c.SqlEditorPage),
    },
    {
        path: "er-diagram",
        loadComponent: () => import("./er-diagram/er-diagram.page").then((c) => c.ErDiagramPage),
    },
    {
        path: "stored-procedure",
        loadComponent: () => import("./stored-procedure/stored-procedure.page").then((c) => c.StoredProcedurePage),
    },
    {
        path: "indexes",
        loadComponent: () => import("src/app/shared/components/index-viewer/index-viewer.component")
            .then((c) => c.IndexViewerComponent),
    },
    {
        path: "session-diff",
        loadComponent: () => import("./session-diff/session-diff.page").then((c) => c.SessionDiffPage),
    },
    { path: "", redirectTo: "no-table", pathMatch: "full" },
];
