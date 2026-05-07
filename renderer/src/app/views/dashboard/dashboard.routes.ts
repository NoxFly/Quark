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
    { path: "", redirectTo: "no-table", pathMatch: "full" },
];
