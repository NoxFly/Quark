import { defineRoutes } from "@noxfly/noxus/main";

export const routes = defineRoutes([
    {
        path: "app",
        load: () => import("./app/app.controller")
    },
]);
