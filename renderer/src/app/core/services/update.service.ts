/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import { inject, Injectable, signal } from "@angular/core";
import type { UpdateInfo, UpdateProgress } from "@shared/update";
import { AlertController } from "@ui/alert/alert.controller";
import { LoadingController } from "@ui/loading/loading.controller";
import type { LoadingComponent } from "@ui/loading/loading.component";
import { ToastController } from "@ui/toast/toast.controller";
import { I18nService } from "src/app/core/services/i18n.service";
import { NoxusService } from "src/app/core/services/noxus.service";

/**
 * Recherche et application des mises à jour côté renderer.
 *
 * Le main détecte les nouvelles versions de manière autonome et pousse
 * `update-available` ; ce service se charge uniquement de proposer la mise à
 * jour et d'en afficher la progression. L'utilisateur n'a rien à configurer.
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

    private loading: LoadingComponent | null = null;

    /**
     * Branche l'écoute des événements poussés par le main.
     * À appeler une seule fois, au démarrage de l'application.
     */
    public listen(): void {
        this.noxus.ipc.onUpdateAvailable(info => {
            this.info.set(info);
            void this.promptUpdate(info);
        });

        this.noxus.ipc.onUpdateProgress(progress => this.showProgress(progress));
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
