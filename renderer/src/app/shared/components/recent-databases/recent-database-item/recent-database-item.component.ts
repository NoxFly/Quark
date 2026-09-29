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

import { ChangeDetectionStrategy, Component, computed, inject, input } from "@angular/core";
import type { RecentDatabaseEntry } from "@shared/ipc-renderer";
import { I18nService } from "src/app/core/services/i18n.service";
import { DRIVER_LOGOS, DRIVER_MONOGRAMS } from "src/app/shared/helpers/driver-presentation.helper";
import { formatRelativeTime } from "src/app/shared/helpers/relative-time.helper";

/**
 * Ligne d'une base récente : vignette 26 px (logo du driver ou monogramme),
 * nom et sous-titre « dossier ou serveur · ancienneté ».
 * Partagée entre la page d'accueil et la liste Ctrl+R ; le parent porte le clic.
 */
@Component({
    selector: "app-recent-database-item",
    standalone: true,
    templateUrl: "./recent-database-item.component.html",
    styleUrl: "./recent-database-item.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecentDatabaseItemComponent {
    private readonly i18n = inject(I18nService);

    public readonly entry = input.required<RecentDatabaseEntry>();

    protected readonly logo = computed<string | null>(() => DRIVER_LOGOS[this.entry().driverType] ?? null);
    protected readonly monogram = computed<string>(() => DRIVER_MONOGRAMS[this.entry().driverType] ?? "DB");

    protected readonly subtitle = computed<string>(() => {
        const entry = this.entry();
        const age = formatRelativeTime(entry.lastOpened, this.i18n.locale());
        return entry.displaySubtitle ? `${entry.displaySubtitle} · ${age}` : age;
    });
}
