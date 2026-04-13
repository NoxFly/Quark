/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import { Injectable } from "@angular/core";
import { UIController } from "src/app/shared/ui/UIComponent.directive";
import type { AlertConfig } from "src/app/shared/ui/ui.types";
import { AlertComponent } from "./alert.component";

@Injectable({ providedIn: "root" })
export class AlertController extends UIController<AlertComponent, AlertConfig> {
    public override async create(config: AlertConfig): Promise<AlertComponent> {
        return this.instanciate(AlertComponent, config);
    }
}
