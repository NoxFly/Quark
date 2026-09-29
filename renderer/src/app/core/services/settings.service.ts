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

import { computed, Injectable, signal } from "@angular/core";
import type { AppSettings, GridDensity } from "src/app/core/models/settings.model";

const SETTINGS_STORAGE_KEY = "quark-settings";

const DEFAULT_SETTINGS: AppSettings = {
    editModeOnStart: false,
    confirmDeletions: true,
    // Désactivé par défaut : l'activer change la persistance des éditions
    // (rien n'est écrit tant que la transaction n'est pas validée).
    autoTransaction: false,
    timestampsAsDates: false,
    gridDensity: "normal",
    sslByDefault: true,
    connectionTimeout: 30,
};

/** Hauteur d'une ligne de grille, en pixels, selon la densité. */
const ROW_HEIGHTS: Record<GridDensity, number> = {
    compact: 28,
    normal: 36,
    comfort: 44,
};

/**
 * Réglages de l'interface (page Paramètres), persistés dans le `localStorage`.
 *
 * Ils ne concernent que l'affichage et le comportement du renderer : un réglage
 * perdu (stockage vidé) retombe sur sa valeur par défaut sans conséquence.
 */
@Injectable({ providedIn: "root" })
export class SettingsService {
    private readonly _settings = signal<AppSettings>(this.load());

    /** Réglages courants, en lecture seule. */
    public readonly settings = this._settings.asReadonly();

    /** Hauteur des lignes de la grille, dérivée de la densité. */
    public readonly rowHeight = computed<number>(() => ROW_HEIGHTS[this._settings().gridDensity]);

    /**
     * @description Modifie un réglage et le persiste.
     * @param key Nom du réglage.
     * @param value Nouvelle valeur.
     * @example settings.set("gridDensity", "compact");
     */
    public set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
        this._settings.update(current => ({ ...current, [key]: value }));
        this.persist();
    }

    /**
     * @description Inverse un réglage booléen et le persiste.
     * @param key Nom d'un réglage booléen.
     */
    public toggle(key: { [K in keyof AppSettings]: AppSettings[K] extends boolean ? K : never }[keyof AppSettings]): void {
        const current = this._settings()[key];
        this.set(key, !current);
    }

    private load(): AppSettings {
        try {
            const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);

            if (!raw) {
                return { ...DEFAULT_SETTINGS };
            }

            const stored = JSON.parse(raw) as Partial<AppSettings>;
            return { ...DEFAULT_SETTINGS, ...stored };
        }
        catch {
            return { ...DEFAULT_SETTINGS };
        }
    }

    private persist(): void {
        try {
            localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(this._settings()));
        }
        catch {
            // Stockage indisponible : le réglage vaut pour la session seulement.
        }
    }
}
