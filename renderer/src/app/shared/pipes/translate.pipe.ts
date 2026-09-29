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

import { inject, Pipe, PipeTransform } from "@angular/core";
import { I18nService } from "src/app/core/services/i18n.service";

/**
 * Pipe de traduction.
 * Impure pour réagir aux changements de locale sans nécessiter
 * de ré-évaluation explicite dans les composants OnPush.
 *
 * @example
 * {{ "menu.file" | translate }}
 * {{ "statusbar.rows" | translate:{ loaded: 10, total: 100 } }}
 */
@Pipe({
    name: "translate",
    standalone: true,
    pure: false,
})
export class TranslatePipe implements PipeTransform {
    private readonly i18n = inject(I18nService);

    /**
     * Traduit une clé avec des paramètres optionnels.
     */
    public transform(key: string, params?: Record<string, string | number>): string {
        return this.i18n.t(key, params);
    }
}
