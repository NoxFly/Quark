/*
 * Quark
 * Copyright (C) 2026 NoxFly
 *
 * FR : Ce programme est un logiciel libre ; vous pouvez le redistribuer ou le
 * modifier selon les termes de la GNU Affero General Public License, version 3,
 * telle que publiée par la Free Software Foundation. Il est distribué dans
 * l'espoir d'être utile, mais SANS AUCUNE GARANTIE. Voir le fichier LICENSE.
 *
 * EN : This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License, version 3, as
 * published by the Free Software Foundation. It is distributed in the hope that
 * it will be useful, but WITHOUT ANY WARRANTY. See the LICENSE file.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
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
