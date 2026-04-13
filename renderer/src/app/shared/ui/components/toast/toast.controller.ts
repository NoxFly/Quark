/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import { Injectable } from "@angular/core";
import { UIController } from "src/app/shared/ui/UIComponent.directive";
import { ToastConfig } from "src/app/shared/ui/ui.types";
import { ToastComponent } from "./toast.component";

@Injectable({ providedIn: "root" })
export class ToastController extends UIController<ToastComponent, ToastConfig> {
    public override async create(config: ToastConfig): Promise<ToastComponent> {
        return this.instanciate(ToastComponent, config);
    }
}
