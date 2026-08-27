import { defineRoutes } from "@noxfly/noxus/main";

export const routes = defineRoutes([
    {
        path: "app",
        load: () => import("./app/app.controller"),
    },
    {
        path: "db",
        load: () => import("./db/db.controller"),
    },
    {
        path: "update",
        load: () => import("./updater/updater.controller"),
    },
]);
