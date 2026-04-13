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
    { path: "", redirectTo: "no-table", pathMatch: "full" },
];
