/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import { Injectable } from "@angular/core";

/** Déclarations minimales de Monaco pour éviter d'importer les types globaux. */
declare const monaco: typeof import("monaco-editor");

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
    private loadPromise: Promise<void> | null = null;
    private loaded = false;

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
