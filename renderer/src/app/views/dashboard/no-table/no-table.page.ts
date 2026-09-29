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

import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { I18nService } from "src/app/core/services/i18n.service";
import { StateService } from "src/app/core/services/state.service";

@Component({
    selector: "app-no-table",
    standalone: true,
    templateUrl: "./no-table.page.html",
    styleUrl: "./no-table.page.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
})
export class NoTablePage {
    protected readonly state = inject(StateService);
    protected readonly i18n = inject(I18nService);

    protected readonly tableCount = computed(() => {
        return this.state.database()?.tables.length ?? 0;
    });
}
