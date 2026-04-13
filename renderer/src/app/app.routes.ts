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
