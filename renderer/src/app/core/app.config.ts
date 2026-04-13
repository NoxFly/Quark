import { ApplicationConfig, provideZonelessChangeDetection } from "@angular/core";
import { provideAnimations } from "@angular/platform-browser/animations";
import { provideRouter, withHashLocation, withViewTransitions } from "@angular/router";
import { routes } from "src/app/app.routes";

export const config: ApplicationConfig = {
    providers: [
        provideZonelessChangeDetection(),
        provideRouter(routes, withViewTransitions(), withHashLocation()),
        // deprecated - removed in v23. Native CSS instead
        // https://angular.dev/guide/animations/migration#example-14
        provideAnimations(),
    ],
};
