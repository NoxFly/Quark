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

import { DOCUMENT, inject, Injectable, signal } from "@angular/core";
import type { Preferences, Theme } from "@shared/preferences";
import type { ThemeOption } from "src/app/core/models/shell.model";

/**
 * Gère l'application du thème visuel (clair / sombre / planifié) et de la taille de police.
 *
 * Responsabilités :
 * - Restauration du thème depuis le localStorage au démarrage.
 * - Application immédiate d'un thème fixe ou du thème planifié.
 * - Planification automatique des transitions de thème.
 * - Application de la taille de police via une variable CSS.
 */
@Injectable({ providedIn: "root" })
export class ThemeService {
    private readonly document = inject(DOCUMENT);

    /** Thèmes proposés, dans l'ordre de la maquette. */
    public static readonly availableThemes: readonly ThemeOption[] = [
        { value: "light", labelKey: "theme.light" },
        { value: "dark", labelKey: "theme.dark" },
        { value: "system", labelKey: "theme.system" },
        { value: "midnight", labelKey: "theme.midnight" },
    ];

    public readonly currentTheme = signal<Theme>("system");

    /**
     * Applique les préférences de thème et de taille de police.
     * Doit être appelé à chaque mise à jour des préférences.
     */
    public applyPreferences(prefs: Preferences): void {
        this.applyTheme(prefs.theme);
    }

    /**
     * Restaure le thème depuis le localStorage avant le premier rendu,
     * pour éviter un flash de contenu non stylisé.
     */
    public restoreFromCache(): void {
        const cachedTheme = (localStorage.getItem("theme") || "system") as Theme;
        this.currentTheme.set(cachedTheme);
        this.document.documentElement.dataset["theme"] = cachedTheme;
    }

    /**
     * Applique un thème et le persiste dans le localStorage.
     */
    public applyTheme(theme: Theme): void {
        this.currentTheme.set(theme);
        localStorage.setItem("theme", theme);
        this.document.documentElement.dataset["theme"] = theme;
    }
}
