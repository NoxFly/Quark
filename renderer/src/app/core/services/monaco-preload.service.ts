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

import { DOCUMENT, inject, Injectable } from "@angular/core";
import { buildMonacoTheme, readMonacoPalette } from "src/app/shared/helpers/monaco-theme.helper";

/** Déclarations minimales de Monaco pour éviter d'importer les types globaux. */
declare const monaco: typeof import("monaco-editor");

/** Nom du thème Monaco dérivé des design tokens de l'application. */
export const MONACO_APP_THEME = "quark";

/**
 * Service de préchargement de Monaco Editor.
 * Charge le runtime AMD en arrière-plan au lancement de l'application
 * pour que l'éditeur SQL soit instantané quand l'utilisateur l'ouvre.
 *
 * Le chargement est différé via `requestIdleCallback` pour ne pas impacter
 * les performances de démarrage.
 */
@Injectable({ providedIn: "root" })
export class MonacoPreloadService {
    private readonly document = inject(DOCUMENT);

    private loadPromise: Promise<void> | null = null;
    private loaded = false;

    /** Le suivi du thème système est branché. */
    private watchingSystemTheme = false;

    /**
     * Indique si le runtime Monaco est chargé et prêt.
     */
    public get isLoaded(): boolean {
        return this.loaded;
    }

    /**
     * Lance le préchargement de Monaco en arrière-plan.
     * Utilise `requestIdleCallback` pour ne pas bloquer le thread principal.
     * Appeler cette méthode plusieurs fois est sans effet (idempotent).
     */
    public preload(): void {
        if (this.loadPromise) {
            return;
        }
        this.loadPromise = this.doLoad();
    }

    /**
     * Retourne une promesse qui se résout quand Monaco est prêt.
     * Si le préchargement n'a pas encore démarré, le lance immédiatement.
     */
    public async whenReady(): Promise<void> {
        if (this.loaded) {
            return;
        }
        if (!this.loadPromise) {
            this.loadPromise = this.doLoad();
        }
        return this.loadPromise;
    }

    /**
     * @description Définit (ou redéfinit) le thème Monaco `quark` à partir des
     * design tokens du thème courant et l'applique à tous les éditeurs.
     *
     * Monaco n'accepte que des couleurs littérales : les propriétés CSS sont donc
     * relues à chaque changement de thème. En thème « système », la bascule
     * clair / sombre de l'OS change les tokens sans passer par `ThemeService` :
     * elle est suivie ici par une requête média.
     *
     * @returns Le nom du thème à passer à `monaco.editor.create`.
     */
    public applyAppTheme(): string {
        if (typeof monaco === "undefined") {
            return MONACO_APP_THEME;
        }

        const styles = getComputedStyle(this.document.documentElement);
        const palette = readMonacoPalette(property => styles.getPropertyValue(property));

        monaco.editor.defineTheme(MONACO_APP_THEME, buildMonacoTheme(palette));
        monaco.editor.setTheme(MONACO_APP_THEME);
        this.watchSystemTheme();

        return MONACO_APP_THEME;
    }

    /**
     * Réapplique le thème Monaco quand le thème de l'OS change.
     */
    private watchSystemTheme(): void {
        const view = this.document.defaultView;

        if (this.watchingSystemTheme || !view) {
            return;
        }

        this.watchingSystemTheme = true;
        // Service racine : l'écouteur vit aussi longtemps que l'application.
        view.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.applyAppTheme());
    }

    /**
     * Charge le AMD loader puis le module principal de Monaco.
     */
    private doLoad(): Promise<void> {
        return new Promise<void>(resolve => {
            // Si Monaco est déjà chargé globalement (ex: rechargement)
            if (typeof monaco !== "undefined") {
                this.loaded = true;
                resolve();
                return;
            }

            const idle = typeof requestIdleCallback === "function"
                ? requestIdleCallback
                : (cb: () => void) => setTimeout(cb, 200);

            idle(() => {
                const loaderScript = document.createElement("script");
                loaderScript.src = "vs/loader.js";
                loaderScript.onload = () => {
                    (window as any).require.config({ paths: { vs: "vs" } });
                    (window as any).require(["vs/editor/editor.main"], () => {
                        this.loaded = true;
                        resolve();
                    });
                };
                loaderScript.onerror = () => {
                    // En cas d'échec, on résout quand même pour ne pas bloquer
                    // l'éditeur tentera de charger par lui-même
                    resolve();
                };
                document.head.appendChild(loaderScript);
            });
        });
    }
}
