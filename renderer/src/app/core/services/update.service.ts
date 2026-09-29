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

import { inject, Injectable, signal } from "@angular/core";
import type { UpdateInfo, UpdateProgress, UpdateSettings } from "@shared/update";
import { AlertController } from "@ui/alert/alert.controller";
import { LoadingController } from "@ui/loading/loading.controller";
import type { LoadingComponent } from "@ui/loading/loading.component";
import { ToastController } from "@ui/toast/toast.controller";
import { I18nService } from "src/app/core/services/i18n.service";
import { NoxusService } from "src/app/core/services/noxus.service";

/**
 * Recherche et application des mises à jour côté renderer.
 *
 * Le main détecte les nouvelles versions de manière autonome (au démarrage puis
 * toutes les heures) et pousse `update-available`. En mode manuel, ce service
 * propose la mise à jour et en affiche la progression ; en mode automatique, le
 * main l'installe seul au premier moment d'inactivité, et l'utilisateur n'en est
 * qu'informé.
 */
@Injectable({ providedIn: "root" })
export class UpdateService {
    private readonly noxus = inject(NoxusService);
    private readonly alertCtrl = inject(AlertController);
    private readonly loadingCtrl = inject(LoadingController);
    private readonly toastCtrl = inject(ToastController);
    private readonly i18n = inject(I18nService);

    /** Dernière information de mise à jour connue. */
    public readonly info = signal<UpdateInfo | null>(null);

    /** Une mise à jour est en cours de téléchargement / d'installation. */
    public readonly applying = signal<boolean>(false);

    /** Réglages de mise à jour, lus auprès du main. */
    public readonly settings = signal<UpdateSettings>({ autoUpdate: false, supported: false });

    private loading: LoadingComponent | null = null;

    /**
     * Branche l'écoute des événements poussés par le main.
     * À appeler une seule fois, au démarrage de l'application.
     */
    public listen(): void {
        this.noxus.ipc.onUpdateAvailable(info => {
            this.info.set(info);

            if (info.autoInstall) {
                void this.notifyAutoInstall(info);
            }
            else {
                void this.promptUpdate(info);
            }
        });

        this.noxus.ipc.onUpdateProgress(progress => this.showProgress(progress));

        void this.loadSettings();
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

    private async loadSettings(): Promise<void> {
        try {
            this.settings.set(await this.noxus.request<UpdateSettings>({ method: "GET", path: "update/settings" }));
        }
        catch (error) {
            console.error("Failed to load update settings:", error);
        }
    }

    /**
     * Mode automatique : l'installation se fera sans rien demander ; on prévient
     * seulement, pour qu'un redémarrage ne surprenne pas l'utilisateur.
     */
    private async notifyAutoInstall(info: UpdateInfo): Promise<void> {
        await this.toastCtrl.create({
            message: this.i18n.t("update.autoInstallScheduled", { version: info.version }),
            duration: 6000,
            color: "primary",
            closable: true,
        });
    }

    /**
     * Recherche manuelle, déclenchée depuis le menu « Aide ».
     * Contrairement à la recherche automatique, elle informe aussi quand
     * l'application est déjà à jour ou quand la vérification échoue.
     */
    public async checkNow(): Promise<void> {
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
    }

    /**
     * Propose la mise à jour détectée et l'applique si l'utilisateur accepte.
     */
    private async promptUpdate(info: UpdateInfo): Promise<void> {
        if (this.applying()) {
            return;
        }

        const installLabel = info.canAutoInstall
            ? this.i18n.t("update.install")
            : this.i18n.t("update.download");

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
                    text: installLabel,
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
     * Télécharge, vérifie et applique la mise à jour.
     *
     * Sur Windows, l'application se termine d'elle-même pour laisser l'installeur
     * remplacer ses fichiers : le voile de chargement reste donc affiché jusqu'à
     * la fermeture, ce qui est le comportement attendu.
     */
    private async applyUpdate(): Promise<void> {
        this.applying.set(true);

        try {
            this.loading = await this.loadingCtrl.create({
                message: this.i18n.t("update.downloading"),
            });

            await this.noxus.request<void>({ method: "POST", path: "update/apply" });
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
            this.dismissLoading();
            this.applying.set(false);
        }
    }

    /**
     * Reporte la progression du téléchargement dans le voile de chargement.
     */
    private showProgress(progress: UpdateProgress): void {
        if (!this.loading) {
            return;
        }

        const message = progress.percent >= 0
            ? this.i18n.t("update.downloadingPercent", { percent: progress.percent })
            : this.i18n.t("update.downloading");

        this.loading.componentRef.setInput("message", message);
    }

    /**
     *
     */
    private dismissLoading(): void {
        this.loading?.dismiss();
        this.loading = null;
    }
}
