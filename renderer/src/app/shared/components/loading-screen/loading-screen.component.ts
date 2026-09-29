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

import { ChangeDetectionStrategy, Component, HostBinding, input, ViewEncapsulation } from "@angular/core";
import { SpinnerComponent } from "src/app/shared/ui/components/spinner/spinner.component";

@Component({
    selector: "app-loading-screen",
    standalone: true,
    templateUrl: "./loading-screen.component.html",
    styleUrl: "./loading-screen.component.scss",
    encapsulation: ViewEncapsulation.None,
    imports: [SpinnerComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoadingScreenComponent {
    public readonly message = input<string>();
    public readonly showContent = input<boolean>(true);

    @HostBinding("class.fade-in")
    protected get fadeIn(): boolean {
        return !this.showContent();
    }
}
