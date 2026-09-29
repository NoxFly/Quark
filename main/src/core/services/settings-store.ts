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

import { Injectable, Logger } from "@noxfly/noxus/main";
import { app } from "electron/main";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Réglages de l'application lus par le main.
 *
 * Les préférences purement visuelles (thème, langue) restent dans le renderer :
 * ne vivent ici que celles dont le main a besoin sans fenêtre au premier plan,
 * comme l'installation automatique des mises à jour.
 */
export interface AppSettings {
    /** Installer les mises à jour sans demander, puis redémarrer. */
    autoUpdate: boolean;
    /**
     * Bases SQLite à rouvrir au prochain démarrage, une par fenêtre. Posé juste
     * avant un redémarrage de mise à jour, consommé au lancement suivant.
     */
    pendingRestore: string[];
}

const DEFAULT_SETTINGS: AppSettings = {
    autoUpdate: false,
    pendingRestore: [],
};

/**
 * Persistance des réglages dans `<userData>/settings.json`.
 *
 * Lecture et écriture synchrones : le fichier fait quelques octets et n'est
 * touché qu'au démarrage ou sur une action explicite de l'utilisateur.
 */
@Injectable({ lifetime: "singleton" })
export class SettingsStore {
    private readonly filePath = join(app.getPath("userData"), "settings.json");
    private settings: AppSettings = this.load();

    public get<K extends keyof AppSettings>(key: K): AppSettings[K] {
        return this.settings[key];
    }

    public set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
        this.settings = { ...this.settings, [key]: value };

        try {
            writeFileSync(this.filePath, `${JSON.stringify(this.settings, null, 4)}\n`, "utf-8");
        }
        catch (error) {
            Logger.error(`Unable to save settings: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Lit le fichier ; un fichier absent ou illisible redonne les valeurs par
     * défaut plutôt que d'empêcher le démarrage.
     */
    private load(): AppSettings {
        try {
            const stored = JSON.parse(readFileSync(this.filePath, "utf-8")) as Partial<AppSettings>;

            return {
                autoUpdate: stored.autoUpdate === true,
                pendingRestore: Array.isArray(stored.pendingRestore)
                    ? stored.pendingRestore.filter((path): path is string => typeof path === "string")
                    : [],
            };
        }
        catch {
            return { ...DEFAULT_SETTINGS };
        }
    }
}
