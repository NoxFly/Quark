/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import { Injectable } from "@angular/core";
import { UIController } from "src/app/shared/ui/UIComponent.directive";
import { ModalConfig } from "src/app/shared/ui/ui.types";
import { ModalComponent } from "./modal.component";

@Injectable({ providedIn: "root" })
export class ModalController extends UIController<ModalComponent, ModalConfig> {
    public override async create(config: ModalConfig): Promise<ModalComponent> {
        return this.instanciate(ModalComponent, config);
    }
}
