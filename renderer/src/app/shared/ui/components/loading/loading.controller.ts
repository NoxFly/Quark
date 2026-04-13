/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import { Injectable } from "@angular/core";
import { UIController } from "src/app/shared/ui/UIComponent.directive";
import { LoadingConfig } from "src/app/shared/ui/ui.types";
import { LoadingComponent } from "./loading.component";

@Injectable({ providedIn: "root" })
export class LoadingController extends UIController<LoadingComponent, LoadingConfig> {
    public override async create(config: LoadingConfig = {}): Promise<LoadingComponent> {
        return this.instanciate(LoadingComponent, config);
    }
}
