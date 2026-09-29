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

import { ChangeDetectionStrategy, Component, inject, input, output, ViewEncapsulation } from "@angular/core";
import { I18nService } from "src/app/core/services/i18n.service";

/**
 * Écran affiché quand l'initialisation de l'application échoue.
 *
 * Il remplace l'écran de chargement, qui recouvre toute la fenêtre : sans lui,
 * un échec d'initialisation se traduit par une fenêtre entièrement blanche, sans
 * message ni moyen d'agir.
 */
@Component({
    selector: "app-startup-error",
    standalone: true,
    templateUrl: "./startup-error.component.html",
    styleUrl: "./startup-error.component.scss",
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StartupErrorComponent {
    // Les traductions sont statiques : elles restent disponibles même quand
    // l'initialisation a échoué.
    protected readonly i18n = inject(I18nService);

    /** Détail technique de l'échec, affiché tel quel pour le support. */
    public readonly details = input<string>("");

    /** Version de l'application, utile dans un rapport d'incident. */
    public readonly appVersion = input<string>("");

    /** Relance uniquement la séquence d'initialisation. */
    public readonly retry = output<void>();

    /** Recharge intégralement le document du renderer. */
    public readonly reload = output<void>();
}
