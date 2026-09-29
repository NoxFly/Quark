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

import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { I18nService } from "src/app/core/services/i18n.service";
import { APP_SHORTCUTS, formatShortcut } from "src/app/shared/helpers/shortcut.helper";
import { TranslatePipe } from "src/app/shared/pipes/translate.pipe";

/**
 * Modale listant les raccourcis clavier de l'application (libellé / touches).
 */
@Component({
    selector: "app-shortcuts",
    standalone: true,
    templateUrl: "./shortcuts.component.html",
    styleUrl: "./shortcuts.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [TranslatePipe],
})
export class ShortcutsComponent {
    private readonly i18n = inject(I18nService);

    /** Callback de fermeture, fourni par l'ouvreur de la modale. */
    public dismiss?: () => void;

    protected readonly shortcuts = APP_SHORTCUTS;

    /**
     * Combinaison affichée dans la langue courante (« Ctrl+Maj+C »).
     */
    protected format(keys: string): string {
        return formatShortcut(keys, key => this.i18n.t(key));
    }

    protected close(): void {
        this.dismiss?.();
    }
}
