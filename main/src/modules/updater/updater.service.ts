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

import { inject, Injectable, Logger, NoxSocket } from "@noxfly/noxus/main";
import type { UpdateInfo, UpdateManifest, UpdateProgress, UpdateSettings } from "@shared/update";
import { shell } from "electron/common";
import { app, BrowserWindow, powerMonitor } from "electron/main";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AppEnv, OSType } from "src/core/env.dto";
import { environment } from "src/core/environment";
import { SettingsStore } from "src/core/services/settings-store";
import { Version } from "src/core/version";

/** Délai avant la première recherche : juste le temps que la fenêtre s'affiche. */
const FIRST_CHECK_DELAY_MS = 5_000;

/** Intervalle entre deux recherches automatiques. */
const CHECK_INTERVAL_MS = 60 * 60 * 1_000;

/** Nouvel essai après un échec (hors ligne, GitHub indisponible). */
const RETRY_DELAY_MS = 10 * 60 * 1_000;

/** Intervalle entre deux vérifications d'inactivité, quand une installation automatique attend. */
const IDLE_POLL_MS = 60 * 1_000;

/**
 * Inactivité du système (clavier, souris) au-delà de laquelle l'application peut
 * redémarrer même si l'une de ses fenêtres est au premier plan.
 */
const SYSTEM_IDLE_SECONDS = 5 * 60;

/** Échéance de récupération du manifeste : une CI indisponible ne doit rien bloquer. */
const MANIFEST_TIMEOUT_MS = 15_000;

/**
 * Ce que l'updater doit savoir de l'application pour redémarrer au bon moment.
 * Fourni par `Application`, qui détient les fenêtres.
 */
export interface UpdaterHost {
    /** Vrai tant qu'un redémarrage ferait perdre du travail (transaction non validée). */
    isBusy(): boolean;
    /** Bases à rouvrir après le redémarrage, une par fenêtre. */
    getRestorableFiles(): string[];
}

/**
 * Recherche, télécharge et applique les mises à jour de l'application.
 *
 * Le manifeste est publié comme asset de la dernière release GitHub, à une URL
 * stable (`releases/latest/download/latest-<os>.json`) : rien n'est à configurer.
 * Une recherche a lieu au démarrage puis toutes les heures.
 *
 * Deux modes :
 * - manuel (défaut) : la version trouvée est proposée ; l'utilisateur l'installe
 *   d'un clic, l'application redémarre d'elle-même une fois installée ;
 * - automatique (réglage `autoUpdate`) : l'installeur est téléchargé aussitôt, puis
 *   appliqué sans rien demander dès que l'application est inactive (en arrière-plan
 *   ou machine au repos) et qu'aucune transaction n'est ouverte ; à défaut, à la
 *   fermeture de l'application.
 *
 * L'installeur téléchargé est vérifié par empreinte SHA-512 avant d'être exécuté :
 * un binaire est lancé avec les droits de l'utilisateur, une archive tronquée ou
 * substituée en chemin ne doit jamais l'être.
 */
@Injectable({ lifetime: "singleton" })
export class UpdaterService {
    private readonly settings = inject(SettingsStore);

    private manifest: UpdateManifest | null = null;
    private info: UpdateInfo | null = null;
    private host: UpdaterHost | null = null;

    private checkTimer: ReturnType<typeof setTimeout> | null = null;
    private idleTimer: ReturnType<typeof setInterval> | null = null;

    /** Installeur déjà téléchargé et vérifié, réutilisé tant que la version ne change pas. */
    private downloaded: { version: string; path: string } | null = null;
    private downloading: Promise<string> | null = null;

    /** L'installeur a été lancé : l'application est en train de se fermer. */
    private installing = false;

    /**
     * Démarre les recherches automatiques : une au démarrage, puis toutes les
     * heures. Sans effet hors production, où aucune release ne correspond à la
     * version locale.
     */
    public startAutoCheck(host: UpdaterHost): void {
        if (environment.env !== AppEnv.PRODUCTION) {
            Logger.info("Auto-update checks are disabled outside production builds.");
            return;
        }

        if (this.host) {
            return;
        }

        this.host = host;

        // Mode automatique : une mise à jour téléchargée mais pas encore appliquée
        // l'est à la fermeture, sans relancer l'application.
        app.on("before-quit", () => this.installOnQuit());

        this.scheduleCheck(FIRST_CHECK_DELAY_MS);
    }

    /**
     * Arrête les recherches automatiques.
     */
    public stopAutoCheck(): void {
        if (this.checkTimer !== null) {
            clearTimeout(this.checkTimer);
            this.checkTimer = null;
        }

        this.stopIdleWatch();
    }

    /**
     * Retourne le résultat de la dernière recherche, sans en déclencher une nouvelle.
     */
    public getInfo(): UpdateInfo | null {
        return this.info;
    }

    /**
     * Réglages de mise à jour exposés au renderer.
     */
    public getSettings(): UpdateSettings {
        return {
            autoUpdate: this.settings.get("autoUpdate"),
            supported: this.canAutoInstall,
        };
    }

    /**
     * Active ou désactive l'installation automatique. Une mise à jour déjà
     * trouvée est prise en charge aussitôt.
     */
    public setAutoUpdate(enabled: boolean): UpdateSettings {
        this.settings.set("autoUpdate", enabled);

        if (this.info) {
            this.info = { ...this.info, autoInstall: this.autoInstallEnabled };
        }

        if (!enabled) {
            this.stopIdleWatch();
        }
        else if (this.info?.isNewer) {
            void this.prepareAutoInstall();
        }

        return this.getSettings();
    }

    /**
     * Interroge le manifeste distant et compare la version publiée à la version courante.
     * @returns L'état de mise à jour ; `isNewer` est faux si l'application est à jour.
     * @throws Error si le manifeste est injoignable ou malformé.
     */
    public async check(): Promise<UpdateInfo> {
        const manifest = await this.fetchManifest();
        const current = Version.parse(environment.product.version);
        const latest = Version.parse(manifest.version);

        if (!current || !latest) {
            throw new Error(`Unable to compare versions: "${environment.product.version}" / "${manifest.version}"`);
        }

        this.manifest = manifest;
        this.info = {
            currentVersion: current.toString(),
            version: manifest.version,
            releaseDate: manifest.releaseDate,
            isNewer: latest.compareTo(current) > 0,
            canAutoInstall: this.canAutoInstall,
            autoInstall: this.autoInstallEnabled,
            notes: manifest.notes,
        };

        Logger.info(`Update check: current=${current.toString()} latest=${latest.toString()} newer=${this.info.isNewer}`);

        return this.info;
    }

    /**
     * Télécharge, vérifie puis applique la mise à jour, à la demande de l'utilisateur.
     *
     * Sur Windows, l'installeur NSIS s'exécute en silence et relance l'application
     * une fois installé. Ailleurs, le paquet exige une élévation que l'application
     * ne peut pas obtenir seule : il est simplement révélé dans l'explorateur.
     *
     * @throws Error si aucune mise à jour n'est disponible, si le téléchargement
     *         échoue, ou si l'empreinte du fichier ne correspond pas au manifeste.
     */
    public async applyUpdate(): Promise<void> {
        if (!this.manifest || !this.info?.isNewer) {
            throw new Error("No update available. Run a check first.");
        }

        const installerPath = await this.downloadOnce(this.manifest);

        if (!this.canAutoInstall) {
            Logger.info(`Installer downloaded to ${installerPath}; manual installation required on ${environment.os}.`);
            shell.showItemInFolder(installerPath);
            return;
        }

        this.install(installerPath, true);
    }

    /**
     * Ouvre la page des releases dans le navigateur par défaut.
     * Recours quand la mise à jour ne peut pas être appliquée par l'application.
     */
    public async openReleasesPage(): Promise<void> {
        await shell.openExternal(environment.update.releasesUrl);
    }

    // --- Helpers privés ---

    /** Seul l'installeur NSIS (Windows) sait s'appliquer sans élévation. */
    private get canAutoInstall(): boolean {
        return environment.os === OSType.Windows;
    }

    private get autoInstallEnabled(): boolean {
        return this.canAutoInstall && this.settings.get("autoUpdate");
    }

    private scheduleCheck(delay: number): void {
        if (this.checkTimer !== null) {
            clearTimeout(this.checkTimer);
        }

        this.checkTimer = setTimeout(() => void this.runScheduledCheck(), delay);
    }

    /**
     * Recherche périodique : notifie le renderer si une version plus récente
     * existe, et ne fait que journaliser un échec (réseau coupé, exécution hors
     * ligne — rien qui doive interrompre l'utilisateur). Un échec est retenté
     * plus tôt que l'intervalle normal.
     */
    private async runScheduledCheck(): Promise<void> {
        let next = CHECK_INTERVAL_MS;

        try {
            const info = await this.check();

            if (info.isNewer) {
                this.broadcast("update-available", info);

                if (info.autoInstall) {
                    void this.prepareAutoInstall();
                }
            }
        }
        catch (error) {
            next = RETRY_DELAY_MS;
            Logger.warn(`Automatic update check failed: ${error instanceof Error ? error.message : String(error)}`);
        }

        this.scheduleCheck(next);
    }

    /**
     * Mode automatique : télécharge l'installeur tout de suite, puis attend un
     * moment d'inactivité pour l'appliquer.
     */
    private async prepareAutoInstall(): Promise<void> {
        const manifest = this.manifest;

        if (!manifest || !this.autoInstallEnabled) {
            return;
        }

        try {
            await this.downloadOnce(manifest);
        }
        catch (error) {
            // La mise à jour reste proposée à la main ; le téléchargement sera
            // retenté à la prochaine recherche.
            Logger.warn(`Background update download failed: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }

        this.startIdleWatch();
    }

    private startIdleWatch(): void {
        if (this.idleTimer !== null) {
            return;
        }

        const tryInstall = (): void => {
            const installer = this.downloaded;

            if (!this.autoInstallEnabled || !installer) {
                this.stopIdleWatch();
                return;
            }

            if (!this.isIdle()) {
                return;
            }

            this.stopIdleWatch();
            Logger.info(`Application idle: installing ${installer.version} automatically.`);
            this.install(installer.path, true);
        };

        this.idleTimer = setInterval(tryInstall, IDLE_POLL_MS);
        tryInstall();
    }

    private stopIdleWatch(): void {
        if (this.idleTimer !== null) {
            clearInterval(this.idleTimer);
            this.idleTimer = null;
        }
    }

    /**
     * L'application peut-elle redémarrer sans gêner l'utilisateur ?
     *
     * Jamais avec une transaction ouverte : ses modifications seraient perdues.
     * Sinon, quand aucune fenêtre n'est au premier plan (l'utilisateur travaille
     * ailleurs) ou quand la machine est au repos depuis quelques minutes.
     */
    private isIdle(): boolean {
        if (this.host?.isBusy() ?? true) {
            return false;
        }

        return BrowserWindow.getFocusedWindow() === null || powerMonitor.getSystemIdleTime() >= SYSTEM_IDLE_SECONDS;
    }

    /**
     * Mode automatique, fermeture de l'application avant tout moment
     * d'inactivité : l'installation se fait maintenant, sans relancer.
     */
    private installOnQuit(): void {
        if (this.installing || !this.autoInstallEnabled || !this.downloaded) {
            return;
        }

        this.install(this.downloaded.path, false);
    }

    /**
     * Lance l'installeur et ferme l'application pour qu'il remplace ses fichiers.
     *
     * Arguments de l'installeur NSIS d'electron-builder : `/S` l'exécute sans
     * fenêtre ni question, `--updated` le signale comme une mise à jour et
     * `--force-run` relance l'application une fois installée, ce que le mode
     * silencieux ne fait pas sans lui.
     *
     * @param relaunch - Relancer l'application après l'installation.
     */
    private install(installerPath: string, relaunch: boolean): void {
        if (this.installing) {
            return;
        }

        this.installing = true;

        // Les bases ouvertes sont rouvertes au redémarrage : une mise à jour
        // automatique ne doit pas faire perdre à l'utilisateur ce qu'il consultait.
        if (relaunch) {
            this.settings.set("pendingRestore", this.host?.getRestorableFiles() ?? []);
        }

        const args = ["--updated", "/S", ...(relaunch ? ["--force-run"] : [])];

        Logger.info(`Launching installer: ${installerPath} ${args.join(" ")}`);

        // Détaché et « unref » pour survivre à l'arrêt de l'application, qui doit
        // libérer ses fichiers.
        spawn(installerPath, args, {
            detached: true,
            stdio: "ignore",
        }).unref();

        app.quit();
    }

    /**
     * Télécharge l'installeur d'une version une seule fois, même si le mode
     * automatique et l'utilisateur le demandent en même temps.
     */
    private async downloadOnce(manifest: UpdateManifest): Promise<string> {
        if (this.downloaded?.version === manifest.version) {
            return this.downloaded.path;
        }

        if (!this.downloading) {
            this.downloading = this.download(manifest)
                .then(path => {
                    this.downloaded = { version: manifest.version, path };
                    return path;
                })
                .finally(() => {
                    this.downloading = null;
                });
        }

        return await this.downloading;
    }

    /**
     * Récupère et valide le manifeste de la dernière version publiée.
     */
    private async fetchManifest(): Promise<UpdateManifest> {
        const url = environment.update.manifestUrl;
        const response = await fetch(url, {
            method: "GET",
            redirect: "follow",
            signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS),
        });

        if (!response.ok) {
            throw new Error(`Update manifest request failed: ${response.status} ${response.statusText} (${url})`);
        }

        const manifest = await response.json() as Partial<UpdateManifest>;

        if (!manifest.version || !manifest.url || !manifest.sha512 || !manifest.path) {
            throw new Error(`Malformed update manifest at ${url}`);
        }

        return manifest as UpdateManifest;
    }

    /**
     * Télécharge l'installeur, vérifie son empreinte et l'écrit dans le dossier
     * temporaire de l'utilisateur.
     * @returns Le chemin absolu du fichier téléchargé.
     */
    private async download(manifest: UpdateManifest): Promise<string> {
        Logger.info(`Downloading update from ${manifest.url}`);

        const response = await fetch(manifest.url, { method: "GET", redirect: "follow" });

        if (!response.ok || !response.body) {
            throw new Error(`Update download failed: ${response.status} ${response.statusText}`);
        }

        const total = Number(response.headers.get("content-length") ?? 0);
        const chunks: Uint8Array[] = [];
        let received = 0;
        let lastReportedPercent = -1;

        for await (const chunk of response.body) {
            chunks.push(chunk);
            received += chunk.byteLength;

            const percent = total > 0 ? Math.floor((received / total) * 100) : -1;

            // Un événement par point de pourcentage : suffisant pour une barre de
            // progression, sans saturer l'IPC sur un fichier de plusieurs dizaines de Mo.
            if (percent !== lastReportedPercent) {
                lastReportedPercent = percent;
                this.broadcast("update-progress", { received, total, percent } satisfies UpdateProgress);
            }
        }

        const buffer = Buffer.concat(chunks);
        const digest = createHash("sha512").update(buffer).digest("hex");

        if (digest.toLowerCase() !== manifest.sha512.toLowerCase()) {
            throw new Error("Downloaded installer is corrupted: SHA-512 mismatch.");
        }

        const installerPath = join(app.getPath("temp"), manifest.path);
        await writeFile(installerPath, buffer);

        return installerPath;
    }

    /**
     * Diffuse un événement à toutes les fenêtres ouvertes.
     */
    private broadcast(event: string, payload: unknown): void {
        inject(NoxSocket).emit(event, payload);
    }
}
