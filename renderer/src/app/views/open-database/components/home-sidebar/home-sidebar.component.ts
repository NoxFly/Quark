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

import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal, viewChild } from "@angular/core";
import type { RecentDatabaseEntry } from "@shared/ipc-renderer";
import { AlertController } from "@ui/alert/alert.controller";
import { ToastController } from "@ui/toast/toast.controller";
import type { NewConnectionDraft } from "src/app/core/models/new-connection.model";
import { ConnectionsService } from "src/app/core/services/connections.service";
import { DatabaseService } from "src/app/core/services/database.service";
import { I18nService } from "src/app/core/services/i18n.service";
import { NoxusService } from "src/app/core/services/noxus.service";
import { SettingsService } from "src/app/core/services/settings.service";
import { StateService } from "src/app/core/services/state.service";
import { ContextMenuComponent } from "src/app/shared/components/context-menu/context-menu.component";
import type { ContextMenuItem } from "src/app/shared/components/context-menu/context-menu.types";
import { RecentDatabaseItemComponent } from "src/app/shared/components/recent-databases/recent-database-item/recent-database-item.component";
import { VaultGateComponent } from "src/app/shared/components/connections-manager/vault-gate/vault-gate.component";
import { profileInputFromRecent } from "src/app/shared/helpers/connections.helper";
import { extractIpcErrorMessage } from "src/app/shared/helpers/utils";
import { SpinnerComponent } from "src/app/shared/ui/components/spinner/spinner.component";
import { TranslatePipe } from "src/app/shared/pipes/translate.pipe";
import { IconComponent } from "src/app/shared/ui/components/icon/icon.component";
import { ModalController } from "src/app/shared/ui/components/modal/modal.controller";

/** Au-delà, la colonne défilerait : la liste complète reste accessible par Ctrl+R. */
const MAX_RECENTS = 8;

/**
 * Colonne gauche de la page d'accueil : identité de l'application, bases
 * ouvertes récemment, accès au gestionnaire de connexions et liens d'aide.
 *
 * Les liens du bas émettent les mêmes événements de document que la titlebar
 * (`open-shortcuts`, `open-settings`, `open-about-dialog`, `open-connections-manager`),
 * écoutés par `AppComponent`. Une base récente en échec propose « Modifier » via
 * l'événement `open-connection-form`, écouté par `OpenDatabasePage`.
 */
@Component({
    selector: "app-home-sidebar",
    standalone: true,
    templateUrl: "./home-sidebar.component.html",
    styleUrl: "./home-sidebar.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [TranslatePipe, RecentDatabaseItemComponent, IconComponent, ContextMenuComponent, SpinnerComponent],
})
export class HomeSidebarComponent implements OnInit {
    private readonly noxus = inject(NoxusService);
    private readonly dbService = inject(DatabaseService);
    private readonly settings = inject(SettingsService);
    private readonly connections = inject(ConnectionsService);
    private readonly i18n = inject(I18nService);
    private readonly alertCtrl = inject(AlertController);
    private readonly toastCtrl = inject(ToastController);
    private readonly modalCtrl = inject(ModalController);
    protected readonly state = inject(StateService);

    protected readonly recents = signal<RecentDatabaseEntry[]>([]);

    /** Entrée en cours d'ouverture, `null` si aucune. */
    protected readonly openingEntry = signal<RecentDatabaseEntry | null>(null);

    private readonly recentMenu = viewChild.required(ContextMenuComponent);

    /** Nombre de profils, `null` tant que le coffre est verrouillé (le compte est inconnu). */
    protected readonly profileCount = computed<number | null>(() => {
        return this.connections.status().unlocked ? this.connections.profiles().length : null;
    });

    public async ngOnInit(): Promise<void> {
        await Promise.all([this.loadRecents(), this.loadVault()]);
    }

    /**
     * Rouvre une base récente ; un échec propose une action adaptée au type de
     * connexion plutôt qu'un message générique.
     */
    protected async openRecent(entry: RecentDatabaseEntry): Promise<void> {
        // Une seule ouverture à la fois : des clics répétés pendant une ouverture
        // lente s'empilaient, et la fenêtre affichait la dernière ouverture à
        // aboutir, pas forcément la dernière base cliquée.
        if (this.openingEntry()) {
            return;
        }

        this.openingEntry.set(entry);

        try {
            await this.dbService.openRecentDatabase(entry, this.settings.settings().connectionTimeout);
        }
        catch (err) {
            this.openingEntry.set(null);
            await this.showOpenFailure(entry, err);
        }
        finally {
            this.openingEntry.set(null);
        }
    }

    /**
     * Retire une base de l'historique (croix au survol, ou menu contextuel).
     * `event` est optionnel : le menu contextuel appelle cette méthode sans clic
     * direct sur la croix.
     */
    protected async removeRecent(entry: RecentDatabaseEntry, event?: Event): Promise<void> {
        event?.stopPropagation();

        try {
            await this.noxus.ipc.removeRecentDatabase(entry);
        }
        catch (err) {
            console.error("Failed to remove recent database:", err);
        }

        await this.loadRecents();
    }

    /**
     * Révèle le fichier d'une base récente dans l'explorateur du système.
     * Absent du menu pour une connexion réseau ou distante (aucun fichier local).
     */
    protected async revealRecent(entry: RecentDatabaseEntry): Promise<void> {
        if (!entry.filePath) {
            return;
        }

        try {
            await this.noxus.ipc.revealInExplorer(entry.filePath);
        }
        catch (err) {
            console.error("Failed to reveal file in explorer:", err);
        }
    }

    /**
     * Enregistre une base récente comme profil dans le gestionnaire de connexions.
     * Déverrouille (ou crée) le coffre d'abord si nécessaire. Le profil créé n'a
     * pas de mot de passe (l'historique ne le connaît pas) : à compléter ensuite
     * par « Modifier » dans le gestionnaire.
     */
    protected async saveRecentToManager(entry: RecentDatabaseEntry): Promise<void> {
        const status = await this.connections.refreshStatus();

        if (!status.unlocked) {
            const opened = await this.promptVaultUnlock(status.initialized ? "unlock" : "init");

            if (!opened) {
                return;
            }
        }

        try {
            await this.connections.create(profileInputFromRecent(entry));
            await this.toastCtrl.create({ message: this.i18n.t("home.toast.profileSaved"), duration: 3000, color: "success" });
        }
        catch (err) {
            const message = this.i18n.t("home.toast.profileFailed", { error: extractIpcErrorMessage(err) });
            await this.toastCtrl.create({ message, duration: 5000, color: "danger", closable: true });
        }
    }

    /**
     * Ouvre le formulaire de nouvelle connexion, préempli avec les informations
     * d'une base récente (menu contextuel, ou action « Modifier » après un échec).
     */
    protected editRecent(entry: RecentDatabaseEntry): void {
        const patch: Partial<NewConnectionDraft> = entry.connectionType === "remote"
            ? { sqliteMode: "url", url: entry.url ?? "" }
            : {
                uri: entry.uri ?? "",
                host: entry.host ?? "",
                port: entry.port ?? 0,
                username: entry.username ?? "",
                database: entry.database ?? "",
            };

        document.dispatchEvent(new CustomEvent("open-connection-form", { detail: { driverType: entry.driverType, patch } }));
    }

    /**
     * Menu contextuel d'une base récente : ouvrir, afficher dans l'explorateur
     * (fichier local uniquement), enregistrer dans le gestionnaire, supprimer.
     */
    protected onRecentContextMenu(event: MouseEvent, entry: RecentDatabaseEntry): void {
        const items: ContextMenuItem[] = [
            { label: this.i18n.t("home.recentMenu.open"), action: () => void this.openRecent(entry) },
        ];

        if (entry.connectionType === "file" && entry.filePath) {
            items.push({ label: this.i18n.t("home.recentMenu.reveal"), action: () => void this.revealRecent(entry) });
        }

        items.push(
            { label: this.i18n.t("home.recentMenu.saveToManager"), action: () => void this.saveRecentToManager(entry) },
            { label: "", action: () => {}, separator: true },
            { label: this.i18n.t("home.recentMenu.remove"), danger: true, action: () => void this.removeRecent(entry) },
        );

        this.recentMenu().open(event, items, entry.displayName);
    }

    /**
     * Déclenche une action partagée avec la titlebar (événement de document).
     */
    protected emit(eventName: string, event: Event): void {
        event.preventDefault();
        document.dispatchEvent(new CustomEvent(eventName));
    }

    /**
     * Confirmation d'échec de réouverture, adaptée au type de connexion : un
     * fichier SQLite introuvable propose de nettoyer l'historique, une connexion
     * réseau ou distante propose de corriger les informations ou de réessayer.
     */
    private async showOpenFailure(entry: RecentDatabaseEntry, err: unknown): Promise<void> {
        const details = extractIpcErrorMessage(err);

        if (entry.connectionType === "file") {
            await this.alertCtrl.create({
                title: this.i18n.t("home.recentFailed.fileTitle"),
                message: this.i18n.t("home.recentFailed.fileMessage", { name: entry.displayName }),
                details,
                color: "danger",
                actions: [
                    { text: this.i18n.t("editor.cancel"), role: "cancel" },
                    {
                        text: this.i18n.t("home.recentFailed.removeAction"),
                        role: "destructive",
                        handler: self => {
                            self.dismiss();
                            void this.removeRecent(entry);
                        },
                    },
                ],
            });
            return;
        }

        await this.alertCtrl.create({
            title: this.i18n.t("home.recentFailed.networkTitle"),
            message: this.i18n.t("home.recentFailed.networkMessage", { name: entry.displayName }),
            details,
            color: "danger",
            actions: [
                { text: this.i18n.t("editor.cancel"), role: "cancel" },
                {
                    text: this.i18n.t("home.recentFailed.editAction"),
                    role: "none",
                    handler: self => {
                        self.dismiss();
                        this.editRecent(entry);
                    },
                },
                {
                    text: this.i18n.t("home.recentFailed.retryAction"),
                    role: "confirm",
                    color: "primary",
                    handler: self => {
                        self.dismiss();
                        void this.openRecent(entry);
                    },
                },
            ],
        });
    }

    /**
     * Ouvre l'écran de déverrouillage (ou de création) du coffre en modale et
     * attend son issue.
     * @returns `true` si le coffre est accessible à l'issue de la modale.
     */
    private async promptVaultUnlock(mode: "init" | "unlock"): Promise<boolean> {
        const modal = await this.modalCtrl.create({
            component: VaultGateComponent,
            componentProps: { mode },
            backdropClose: false,
            showDots: false,
            blurry: false,
        });

        const gate = modal.getComponentInstance<VaultGateComponent>();

        if (!gate) {
            await modal.dismiss();
            return false;
        }

        return await new Promise<boolean>(resolve => {
            const openedSub = gate.opened.subscribe(() => {
                openedSub.unsubscribe();
                cancelledSub.unsubscribe();
                void modal.dismiss();
                resolve(true);
            });
            const cancelledSub = gate.cancelled.subscribe(() => {
                openedSub.unsubscribe();
                cancelledSub.unsubscribe();
                void modal.dismiss();
                resolve(false);
            });
        });
    }

    private async loadRecents(): Promise<void> {
        try {
            const entries = await this.noxus.ipc.getRecentDatabases();
            this.recents.set(entries.slice(0, MAX_RECENTS));
        }
        catch {
            // Historique illisible : la section reste vide, l'accueil reste utilisable.
            this.recents.set([]);
        }
    }

    private async loadVault(): Promise<void> {
        try {
            const status = await this.connections.refreshStatus();

            if (status.unlocked) {
                await this.connections.loadProfiles();
            }
        }
        catch {
            // Coffre indisponible : le compteur affiche le cadenas.
        }
    }
}
