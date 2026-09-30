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

import { computed, inject, Injectable, signal } from "@angular/core";
import type { UpdateInfo, UpdateProgress, UpdateSettings } from "@shared/update";
import { AlertController } from "@ui/alert/alert.controller";
import { ToastController } from "@ui/toast/toast.controller";
import { I18nService } from "src/app/core/services/i18n.service";
import { NoxusService } from "src/app/core/services/noxus.service";

/**
 * Recherche et application des mises à jour côté renderer.
 *
 * Le main détecte les nouvelles versions de manière autonome (au démarrage puis
 * toutes les heures) et pousse `update-available`. Rien n'interrompt
 * l'utilisateur : la titlebar signale la version, en affiche le téléchargement
 * puis propose de l'installer. En mode manuel, le téléchargement n'a lieu qu'une
 * fois la mise à jour demandée ; en mode automatique, le main télécharge
 * l'installeur aussitôt et l'installe au plus tard à la fermeture.
 */
@Injectable({ providedIn: "root" })
export class UpdateService {
    private readonly noxus = inject(NoxusService);
    private readonly alertCtrl = inject(AlertController);
    private readonly toastCtrl = inject(ToastController);
    private readonly i18n = inject(I18nService);

    /** Dernière information de mise à jour connue. */
    public readonly info = signal<UpdateInfo | null>(null);

    /**
     * Une recherche de mise à jour est en cours (automatique, au démarrage ou
     * périodique, ou manuelle via `checkNow`). Pilote le spinner de la titlebar.
     */
    public readonly checking = signal<boolean>(false);

    /** L'utilisateur a lancé la mise à jour : téléchargement puis installation. */
    public readonly applying = signal<boolean>(false);

    /** Progression du téléchargement de l'installeur, `null` hors téléchargement. */
    public readonly progress = signal<UpdateProgress | null>(null);

    /**
     * L'installeur est prêt : un clic suffit pour installer et redémarrer. Seul
     * Windows sait l'appliquer lui-même ; ailleurs, la mise à jour reste proposée
     * comme un téléchargement.
     */
    public readonly readyToInstall = computed<boolean>(() => {
        const info = this.info();
        return info?.isNewer === true && info.downloaded && info.canAutoInstall && this.progress() === null;
    });

    /** Réglages de mise à jour, lus auprès du main. */
    public readonly settings = signal<UpdateSettings>({ autoUpdate: false, supported: false });

    /**
     * Branche l'écoute des événements poussés par le main.
     * À appeler une seule fois, au démarrage de l'application.
     */
    public listen(): void {
        // Aucune fenêtre surgissante : la flèche de la titlebar suffit, et la
        // confirmation ne s'ouvre que sur son clic.
        this.noxus.ipc.onUpdateAvailable(info => this.info.set(info));
        this.noxus.ipc.onUpdateChecking(checking => this.checking.set(checking));
        this.noxus.ipc.onUpdateProgress(progress => this.progress.set(progress));

        this.noxus.ipc.onUpdateDownloaded(info => {
            this.progress.set(null);
            this.info.set(info);
        });

        this.noxus.ipc.onUpdateDownloadFailed(error => {
            this.progress.set(null);
            console.warn("Update download failed:", error);
        });

        void this.loadSettings();
        void this.loadInfo();
    }

    /**
     * Active ou désactive l'installation automatique des mises à jour.
     */
    public async toggleAutoUpdate(): Promise<void> {
        const autoUpdate = !this.settings().autoUpdate;

        try {
            this.settings.set(await this.noxus.request<UpdateSettings>({
                method: "POST",
                path: "update/settings",
                body: { autoUpdate },
            }));
        }
        catch (error) {
            console.error("Failed to save update settings:", error);
        }
    }

    /**
     * Relit la dernière recherche du main : après un rechargement de la fenêtre,
     * `update-available` ne sera pas renvoyé avant la prochaine recherche.
     */
    private async loadInfo(): Promise<void> {
        try {
            const info = await this.noxus.request<UpdateInfo | null>({ method: "GET", path: "update/info" });

            if (info) {
                this.info.set(info);
            }
        }
        catch (error) {
            console.error("Failed to load update info:", error);
        }
    }

    private async loadSettings(): Promise<void> {
        try {
            this.settings.set(await this.noxus.request<UpdateSettings>({ method: "GET", path: "update/settings" }));
        }
        catch (error) {
            console.error("Failed to load update settings:", error);
        }
    }

    /**
     * Recherche manuelle, déclenchée depuis le menu « Aide ».
     * Contrairement à la recherche automatique, elle informe aussi quand
     * l'application est déjà à jour ou quand la vérification échoue.
     */
    public async checkNow(): Promise<void> {
        this.checking.set(true);

        try {
            const info = await this.noxus.request<UpdateInfo>({ method: "GET", path: "update/check" });
            this.info.set(info);

            if (info.isNewer) {
                await this.promptUpdate(info);
                return;
            }

            await this.toastCtrl.create({
                message: this.i18n.t("update.upToDate", { version: info.currentVersion }),
                duration: 4000,
                color: "success",
                closable: true,
            });
        }
        catch (error) {
            await this.alertCtrl.create({
                title: this.i18n.t("update.checkFailedTitle"),
                message: this.i18n.t("update.checkFailedMessage"),
                color: "danger",
                details: error instanceof Error ? error.message : String(error),
                actions: [{ text: "OK", role: "cancel" }],
            });
        }
        finally {
            this.checking.set(false);
        }
    }

    /**
     * Libellé du bouton qui déclenche l'installation, selon que l'application
     * sache l'appliquer elle-même ou doive seulement télécharger l'installeur
     * (paquet deb/rpm, qui exige une élévation). Public : réutilisé par le
     * bandeau intégré de la page Paramètres.
     */
    public installLabel(info: UpdateInfo): string {
        return info.canAutoInstall ? this.i18n.t("update.install") : this.i18n.t("update.download");
    }

    /**
     * Propose la mise à jour détectée et l'applique si l'utilisateur accepte.
     * Public : réutilisée quand l'utilisateur clique la flèche de téléchargement
     * de la titlebar pour rouvrir la même confirmation qu'à la détection.
     */
    public async promptUpdate(info: UpdateInfo): Promise<void> {
        if (this.applying()) {
            return;
        }

        await this.alertCtrl.create({
            title: this.i18n.t("update.availableTitle", { version: info.version }),
            message: this.i18n.t("update.availableMessage", {
                current: info.currentVersion,
                version: info.version,
            }),
            color: "primary",
            details: info.notes,
            actions: [
                { text: this.i18n.t("update.later"), role: "cancel" },
                {
                    text: this.installLabel(info),
                    role: "confirm",
                    color: "primary",
                    handler: self => {
                        self.dismiss({ role: "confirm" });
                        void this.applyUpdate();
                    },
                },
            ],
        });
    }

    /**
     * Télécharge si besoin, vérifie et applique la mise à jour détectée. Public :
     * appelée par le bouton « Mettre à jour » de la titlebar, installeur déjà
     * téléchargé, et par le bandeau de la page Paramètres, qui n'a pas de bouton
     * « Plus tard » et ne passe donc pas par `promptUpdate`.
     */
    public async install(): Promise<void> {
        await this.applyUpdate();
    }

    /**
     * Télécharge, vérifie et applique la mise à jour.
     *
     * L'interface reste utilisable pendant le téléchargement, dont la titlebar
     * affiche la progression. Sur Windows, l'application se termine ensuite
     * d'elle-même pour laisser l'installeur remplacer ses fichiers.
     *
     * Échéance désactivée côté client (`timeout: 0`) : le délai par défaut de
     * `NoxusService` (30 s) couvre le téléchargement d'un installeur de plusieurs
     * dizaines de Mo, sa vérification et son lancement. Sans cela, une connexion
     * lente fait expirer la requête pendant que le téléchargement se poursuit
     * réellement côté main — l'utilisateur voit alors une erreur alors que la
     * mise à jour vient de s'appliquer avec succès juste après.
     */
    private async applyUpdate(): Promise<void> {
        if (this.applying()) {
            return;
        }

        this.applying.set(true);

        try {
            await this.noxus.request<void>({ method: "POST", path: "update/apply" }, { timeout: 0 });
        }
        catch (error) {
            await this.alertCtrl.create({
                title: this.i18n.t("update.failedTitle"),
                message: this.i18n.t("update.failedMessage"),
                color: "danger",
                details: error instanceof Error ? error.message : String(error),
                actions: [
                    { text: "OK", role: "cancel" },
                    {
                        text: this.i18n.t("update.openReleases"),
                        role: "none",
                        color: "primary",
                        handler: () => {
                            void this.noxus.request<void>({ method: "POST", path: "update/open-releases" });
                        },
                    },
                ],
            });
        }
        finally {
            this.applying.set(false);
        }
    }
}
