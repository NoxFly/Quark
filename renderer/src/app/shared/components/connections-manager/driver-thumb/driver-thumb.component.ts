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

import { ChangeDetectionStrategy, Component, computed, input, signal } from "@angular/core";
import type { DatabaseDriverType } from "@shared/driver";
import type { DriverThumbVariant } from "src/app/core/models/connections.model";
import { driverLogo, driverMonogram } from "src/app/shared/helpers/connections.helper";

/**
 * Vignette d'un driver : son logo, ou son monogramme (Fira Code) si le logo manque
 * ou ne se charge pas.
 */
@Component({
    selector: "app-driver-thumb",
    standalone: true,
    template: `
        @if (logo(); as src) {
            <img [src]="src" alt="" (error)="failed.set(true)" />
        }
        @else {
            {{ monogram() }}
        }
    `,
    styleUrl: "./driver-thumb.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        "[attr.data-variant]": "variant()",
    },
})
export class DriverThumbComponent {
    public readonly driverType = input.required<DatabaseDriverType>();
    public readonly variant = input<DriverThumbVariant>("tree");

    protected readonly failed = signal<boolean>(false);
    protected readonly logo = computed<string | null>(() => (this.failed() ? null : driverLogo(this.driverType())));
    protected readonly monogram = computed<string>(() => driverMonogram(this.driverType()));
}
