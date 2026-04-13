import { enableProdMode } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { AppComponent } from "src/app/app.component";
import { config } from "src/app/core/app.config";
import { environment } from "src/environments/environment";


if (environment.production) {
    enableProdMode();
}

await bootstrapApplication(AppComponent, config);
