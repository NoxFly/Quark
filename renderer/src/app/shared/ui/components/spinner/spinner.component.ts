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

import { ChangeDetectionStrategy, Component, input, ViewEncapsulation } from "@angular/core";
import type { UIColor } from "src/app/shared/ui/ui.types";

@Component({
    selector: "ui-spinner",
    standalone: true,
    templateUrl: "./spinner.component.html",
    styleUrl: "./spinner.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    encapsulation: ViewEncapsulation.None,
    host: {
        "[class.absolute]": "absolute() !== false",
    },
})
export class SpinnerComponent {
    public readonly color = input<UIColor>("default");
    public readonly absolute = input<boolean | "">(false);
}
