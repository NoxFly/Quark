/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import { Injectable, Logger } from "@noxfly/noxus/main";
import type { UpdateInfo, UpdateManifest, UpdateProgress } from "@shared/update";
import { shell } from "electron/common";
import { app, BrowserWindow } from "electron/main";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AppEnv, OSType } from "src/core/env.dto";
import { environment } from "src/core/environment";
import { Version } from "src/core/version";

/** Délai avant la première recherche, pour ne pas concurrencer le démarrage. */
const FIRST_CHECK_DELAY_MS = 15_000;

/** Intervalle entre deux recherches automatiques. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;

/** Échéance de récupération du manifeste : une CI indisponible ne doit rien bloquer. */
const MANIFEST_TIMEOUT_MS = 15_000;

/**
 * Recherche, télécharge et applique les mises à jour de l'application.
 *
 * Le manifeste est publié comme asset de la dernière release GitHub, à une URL
 * stable (`releases/latest/download/latest-<os>.json`) : aucune configuration
 * n'est demandée à l'utilisateur, et rien n'est à mettre à jour côté client
 * quand une nouvelle version paraît.
 *
 * L'installeur téléchargé est vérifié par empreinte SHA-512 avant d'être exécuté :
 * un binaire est lancé avec les droits de l'utilisateur, une archive tronquée ou
 * substituée en chemin ne doit jamais l'être.
 */
@Injectable({ lifetime: "singleton" })
export class UpdaterService {
    private manifest: UpdateManifest | null = null;
    private info: UpdateInfo | null = null;
    private checkTimer: ReturnType<typeof setInterval> | null = null;
    private busy = false;

    /**
     * Démarre les recherches automatiques : une première différée, puis
     * périodiques. Sans effet hors production, où aucune release ne correspond
     * à la version locale.
     */
    public startAutoCheck(): void {
        if (environment.env !== AppEnv.PRODUCTION) {
            Logger.info("Auto-update checks are disabled outside production builds.");
            return;
        }

        if (this.checkTimer !== null) {
            return;
        }

        setTimeout(() => void this.checkSilently(), FIRST_CHECK_DELAY_MS);

        this.checkTimer = setInterval(() => void this.checkSilently(), CHECK_INTERVAL_MS);
    }

    /**
     * Arrête les recherches automatiques.
     */
    public stopAutoCheck(): void {
        if (this.checkTimer !== null) {
            clearInterval(this.checkTimer);
            this.checkTimer = null;
        }
    }

    /**
     * Retourne le résultat de la dernière recherche, sans en déclencher une nouvelle.
     */
    public getInfo(): UpdateInfo | null {
        return this.info;
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
            canAutoInstall: environment.os === OSType.Windows,
            notes: manifest.notes,
        };

        Logger.info(`Update check: current=${current.toString()} latest=${latest.toString()} newer=${this.info.isNewer}`);

        return this.info;
    }

    /**
     * Télécharge, vérifie puis applique la mise à jour.
     *
     * Sur Windows, l'installeur NSIS est lancé en mode silencieux et l'application
     * se termine pour lui laisser remplacer ses fichiers. Ailleurs, le paquet exige
     * une élévation que l'application ne peut pas obtenir seule : il est simplement
     * révélé dans l'explorateur de fichiers.
     *
     * @throws Error si aucune mise à jour n'est disponible, si le téléchargement
     *         échoue, ou si l'empreinte du fichier ne correspond pas au manifeste.
     */
    public async applyUpdate(): Promise<void> {
        const manifest = this.manifest;

        if (!manifest || !this.info?.isNewer) {
            throw new Error("No update available. Run a check first.");
        }

        if (this.busy) {
            throw new Error("An update is already being applied.");
        }

        this.busy = true;

        try {
            const installerPath = await this.download(manifest);

            if (environment.os !== OSType.Windows) {
                Logger.info(`Installer downloaded to ${installerPath}; manual installation required on ${environment.os}.`);
                shell.showItemInFolder(installerPath);
                return;
            }

            Logger.info(`Launching installer: ${installerPath}`);

            // `/S` : mode silencieux NSIS. Détaché et « unref » pour survivre à
            // l'arrêt de l'application, qui doit libérer ses fichiers.
            spawn(installerPath, ["/S"], {
                detached: true,
                stdio: "ignore",
            }).unref();

            app.quit();
        }
        finally {
            this.busy = false;
        }
    }

    /**
     * Ouvre la page des releases dans le navigateur par défaut.
     * Recours quand la mise à jour ne peut pas être appliquée par l'application.
     */
    public async openReleasesPage(): Promise<void> {
        await shell.openExternal(environment.update.releasesUrl);
    }

    // --- Helpers privés ---

    /**
     * Recherche silencieuse : notifie le renderer si une version plus récente
     * existe, et se contente de journaliser en cas d'échec (réseau coupé,
     * exécution hors ligne — rien qui doive interrompre l'utilisateur).
     */
    private async checkSilently(): Promise<void> {
        try {
            const info = await this.check();

            if (info.isNewer) {
                this.broadcast("update-available", info);
            }
        }
        catch (error) {
            Logger.warn(`Automatic update check failed: ${error instanceof Error ? error.message : String(error)}`);
        }
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
    private broadcast(channel: string, payload: unknown): void {
        for (const window of BrowserWindow.getAllWindows()) {
            window.webContents.send(channel, payload);
        }
    }
}
