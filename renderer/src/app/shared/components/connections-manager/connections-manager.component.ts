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

import { ChangeDetectionStrategy, Component, computed, inject, type OnInit, signal, viewChild } from "@angular/core";
import type { ConnectionFolder, ConnectionProfile, ConnectionProfileInput } from "@shared/connection";
import type { DriverInfo } from "@shared/driver";
import type {
    ConnectionFolderNode,
    ConnectionProfileMove,
    ConnectionsManagerView,
    ConnectionsPaneMode,
} from "src/app/core/models/connections.model";
import { ConnectionsService } from "src/app/core/services/connections.service";
import { I18nService } from "src/app/core/services/i18n.service";
import { NoxusService } from "src/app/core/services/noxus.service";
import { groupProfilesByFolder, isShareableProfile, sortFolders } from "src/app/shared/helpers/connections.helper";
import { extractIpcErrorMessage } from "src/app/shared/helpers/utils";
import { TranslatePipe } from "src/app/shared/pipes/translate.pipe";
import { ConnectionFormComponent } from "src/app/shared/components/connection-form/connection-form.component";
import { ConnectionDetailsComponent } from "src/app/shared/components/connections-manager/connection-details/connection-details.component";
import {
    ConnectionTreeComponent,
    type ProfileContextMenuEvent,
} from "src/app/shared/components/connections-manager/connection-tree/connection-tree.component";
import { ConnectionFolderFormComponent } from "src/app/shared/components/connections-manager/folder-form/folder-form.component";
import { SecretPromptComponent } from "src/app/shared/components/connections-manager/secret-prompt/secret-prompt.component";
import { ShareDialogComponent } from "src/app/shared/components/connections-manager/share-dialog/share-dialog.component";
import { TagManagerComponent } from "src/app/shared/components/connections-manager/tag-manager/tag-manager.component";
import { ContextMenuComponent } from "src/app/shared/components/context-menu/context-menu.component";
import type { ContextMenuItem } from "src/app/shared/components/context-menu/context-menu.types";
import { VaultGateComponent } from "src/app/shared/components/connections-manager/vault-gate/vault-gate.component";
import { AlertController } from "@ui/alert/alert.controller";
import { ToastController } from "@ui/toast/toast.controller";
import type { UIColor } from "src/app/shared/ui/ui.types";

/**
 * Gestionnaire de connexions sauvegardées (Fichier > Connexions).
 *
 * Orchestre les états du coffre chiffré (création du mot de passe maître, déverrouillage),
 * l'arbre dossiers / profils, le volet de droite (fiche, formulaire, dossier) et la saisie
 * de la passphrase d'import. Le mot de passe maître se règle dans les Paramètres.
 */
@Component({
    selector: "app-connections-manager",
    standalone: true,
    templateUrl: "./connections-manager.component.html",
    styleUrl: "./connections-manager.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        TranslatePipe,
        ConnectionFormComponent,
        ConnectionDetailsComponent,
        ConnectionTreeComponent,
        ConnectionFolderFormComponent,
        SecretPromptComponent,
        TagManagerComponent,
        ShareDialogComponent,
        ContextMenuComponent,
        VaultGateComponent,
    ],
})
export class ConnectionsManagerComponent implements OnInit {
    protected readonly connections = inject(ConnectionsService);
    private readonly noxus = inject(NoxusService);
    private readonly i18n = inject(I18nService);
    private readonly alertCtrl = inject(AlertController);
    private readonly toastCtrl = inject(ToastController);

    /** Callback de fermeture, fourni par l'ouvreur du modal. */
    public dismiss?: () => void;

    protected readonly view = signal<ConnectionsManagerView>("loading");
    protected readonly mode = signal<ConnectionsPaneMode>("view");
    protected readonly driverInfos = signal<DriverInfo[]>([]);
    protected readonly selectedProfileId = signal<string | null>(null);
    protected readonly selectedFolderId = signal<string | null>(null);
    protected readonly editingProfile = signal<ConnectionProfile | null>(null);
    protected readonly formSession = signal<number>(0);
    protected readonly busy = signal<boolean>(false);

    /** La saisie de la passphrase d'import est ouverte. */
    protected readonly importPrompt = signal<boolean>(false);
    protected readonly importError = signal<string | null>(null);

    /** Profil dont on crée un fichier de partage. */
    protected readonly sharingProfile = signal<ConnectionProfile | null>(null);

    /** La gestion des étiquettes est ouverte. */
    protected readonly tagManagerOpen = signal<boolean>(false);

    private readonly profileMenu = viewChild(ContextMenuComponent);

    protected readonly tree = computed<ConnectionFolderNode[]>(() => groupProfilesByFolder(
        this.connections.folders(),
        this.connections.profiles(),
        this.i18n.t("connections.folder.unfiled"),
    ));

    protected readonly sortedFolders = computed<ConnectionFolder[]>(() => sortFolders(this.connections.folders()));

    protected readonly selectedProfile = computed<ConnectionProfile | null>(() => {
        const id = this.selectedProfileId();
        return this.connections.profiles().find(profile => profile.id === id) ?? null;
    });

    /** Nœud du profil sélectionné (son dossier effectif, repli compris). */
    protected readonly selectedProfileFolder = computed<ConnectionFolderNode | null>(() => {
        const id = this.selectedProfileId();
        return this.tree().find(node => node.profiles.some(profile => profile.id === id)) ?? null;
    });

    protected readonly selectedFolder = computed<ConnectionFolderNode | null>(() => {
        const id = this.selectedFolderId();
        return this.tree().find(node => node.id === id) ?? null;
    });

    /** Dossier présélectionné dans le formulaire de création. */
    protected readonly defaultFolderId = computed<string>(() => {
        const selected = this.selectedFolder() ?? this.selectedProfileFolder();

        if (selected && !selected.virtual) {
            return selected.id;
        }

        return this.sortedFolders()[0]?.id ?? "";
    });

    protected readonly masterEnabled = computed<boolean>(() => this.connections.status().masterPasswordEnabled);

    public async ngOnInit(): Promise<void> {
        try {
            this.driverInfos.set(await this.noxus.ipc.getAllDriverInfos());
        }
        catch {
            // Sans métadonnées, les pastilles de type restent vides mais le coffre reste utilisable.
        }

        const status = await this.connections.refreshStatus();

        if (!status.initialized) {
            this.view.set("init");
            return;
        }

        if (status.unlocked) {
            await this.connections.loadAll();
            this.enterManager();
            return;
        }

        // Sans mot de passe maître, la clé est protégée par le trousseau du système : pas de saisie.
        if (!status.masterPasswordEnabled && await this.tryUnlock("")) {
            return;
        }

        this.view.set("unlock");
    }

    /**
     * Ferme le gestionnaire.
     */
    protected close(): void {
        this.dismiss?.();
    }

    /**
     * Le coffre vient d'être créé ou déverrouillé par l'écran d'accès.
     */
    protected onVaultOpened(): void {
        this.enterManager();
    }

    /**
     * Verrouille le coffre et revient à l'écran de déverrouillage.
     */
    protected async lockVault(): Promise<void> {
        await this.connections.lock();
        this.view.set("unlock");
    }

    /**
     * Sélectionne un profil et affiche sa fiche.
     */
    protected selectProfile(profile: ConnectionProfile): void {
        this.selectedProfileId.set(profile.id);
        this.selectedFolderId.set(null);
        this.mode.set("view");
    }

    /**
     * Sélectionne un dossier et ouvre son édition (renommage / suppression).
     */
    protected selectFolder(folder: ConnectionFolderNode): void {
        this.selectedFolderId.set(folder.id);
        this.selectedProfileId.set(null);
        this.mode.set("folder");
    }

    /**
     * Ouvre le formulaire de création d'un profil.
     */
    protected newProfile(): void {
        this.openForm(null);
    }

    /**
     * Ouvre le formulaire d'édition du profil sélectionné.
     */
    protected editSelected(): void {
        const profile = this.selectedProfile();

        if (profile) {
            this.openForm(profile);
        }
    }

    /**
     * Ouvre le volet de création d'un dossier.
     */
    protected newFolder(): void {
        this.selectedFolderId.set(null);
        this.mode.set("folder");
    }

    /**
     * Annule le formulaire de profil ou de dossier et revient au contexte précédent.
     *
     * Un dossier n'a qu'un seul mode (pas de distinction vue / édition comme un
     * profil) : le sélectionner dans l'arbre ouvre directement son formulaire de
     * renommage, en mode `"folder"`. Annuler CE formulaire doit donc désélectionner
     * le dossier plutôt que réafficher le même mode — sinon rien ne changeait
     * visiblement à l'écran (l'ancien calcul renvoyait "folder" alors qu'on y était
     * déjà). En revanche, annuler un formulaire de profil ouvert par-dessus un
     * dossier sélectionné (« + Connexion » depuis ce dossier) doit bien y revenir :
     * seule l'origine de l'annulation (le mode courant) distingue les deux cas.
     */
    protected cancelPane(): void {
        const cancellingFolderForm = this.mode() === "folder";

        if (cancellingFolderForm) {
            this.selectedFolderId.set(null);
        }

        const backToFolder = !cancellingFolderForm && this.selectedFolderId() !== null && this.selectedProfileId() === null;
        this.mode.set(backToFolder ? "folder" : "view");
    }

    /**
     * Persiste le profil saisi (création ou édition) puis affiche sa fiche.
     */
    protected async saveProfile(input: ConnectionProfileInput): Promise<void> {
        const editing = this.editingProfile();

        await this.runBusy(async () => {
            const saved = editing
                ? await this.connections.update(editing.id, input)
                : await this.connections.create(input);

            if (saved.folderId) {
                this.connections.expandFolder(saved.folderId);
            }

            this.selectProfile(saved);
            await this.toast(this.i18n.t(editing ? "connections.updated" : "connections.created"));
        });
    }

    /**
     * Crée ou renomme le dossier édité.
     */
    protected async saveFolder(name: string): Promise<void> {
        const folder = this.selectedFolder();

        await this.runBusy(async () => {
            if (folder && !folder.virtual) {
                await this.connections.renameFolder(folder.id, name);
                await this.toast(this.i18n.t("connections.folder.renamed"));
            }
            else {
                await this.connections.createFolder(name);
                await this.toast(this.i18n.t("connections.folder.created"));
            }

            this.selectedFolderId.set(null);
            this.mode.set("view");
        });
    }

    /**
     * Demande confirmation puis supprime le profil sélectionné.
     */
    protected async confirmDeleteProfile(): Promise<void> {
        const profile = this.selectedProfile();

        if (!profile) {
            return;
        }

        await this.confirmDanger(
            this.i18n.t("connections.deleteTitle", { name: profile.name }),
            this.i18n.t("connections.deleteMessage"),
            this.i18n.t("connections.deleteConfirm"),
            async () => {
                await this.connections.remove(profile.id);
                this.selectFirst();
                await this.toast(this.i18n.t("connections.deleted"));
            },
        );
    }

    /**
     * Demande confirmation puis supprime le dossier sélectionné.
     */
    protected async confirmDeleteFolder(): Promise<void> {
        const folder = this.selectedFolder();

        if (!folder || folder.virtual) {
            return;
        }

        const count = folder.profiles.length;
        const message = count > 0
            ? this.i18n.t("connections.folder.deleteMoved", { count })
            : this.i18n.t("connections.folder.deleteEmpty");

        await this.confirmDanger(
            this.i18n.t("connections.folder.deleteTitle", { name: folder.name }),
            message,
            this.i18n.t("connections.delete"),
            async () => {
                await this.connections.deleteFolder(folder.id);
                this.selectedFolderId.set(null);
                this.mode.set("view");
                await this.toast(this.i18n.t("connections.folder.deleted"));
            },
        );
    }

    /**
     * Connecte la fenêtre au profil et ferme le gestionnaire.
     */
    protected async connectProfile(profile: ConnectionProfile | null): Promise<void> {
        if (!profile || this.busy()) {
            return;
        }

        await this.runBusy(async () => {
            await this.connections.connect(profile);
            this.close();
        });
    }

    /**
     * Applique un glisser-déposer de l'arbre.
     */
    protected async moveProfile(move: ConnectionProfileMove): Promise<void> {
        await this.runBusy(() => this.connections.moveProfile(move.id, move.folderId, move.index));
    }

    /**
     * Menu contextuel d'un profil de l'arbre : le profil est sélectionné, pour que
     * les actions portent sur la fiche affichée.
     */
    protected openProfileMenu({ event, profile }: ProfileContextMenuEvent): void {
        this.selectProfile(profile);

        const items: ContextMenuItem[] = [
            { label: this.i18n.t("connections.connect"), action: () => void this.connectProfile(profile) },
            { label: this.i18n.t("connections.edit"), action: () => this.editSelected() },
        ];

        if (isShareableProfile(profile)) {
            items.push({ label: this.i18n.t("connections.share"), action: () => this.openShare(profile) });
        }

        items.push(
            { label: "", action: () => {}, separator: true },
            { label: this.i18n.t("connections.delete"), danger: true, action: () => void this.confirmDeleteProfile() },
        );

        this.profileMenu()?.open(event, items, profile.name);
    }

    /**
     * Ouvre la création d'un fichier de partage pour un profil distant.
     */
    protected openShare(profile: ConnectionProfile): void {
        if (!isShareableProfile(profile)) {
            return;
        }

        this.sharingProfile.set(profile);
    }

    /**
     * Ouvre la saisie de la passphrase d'un fichier de profils à importer.
     */
    protected openImportPrompt(): void {
        this.importError.set(null);
        this.importPrompt.set(true);
    }

    /**
     * Importe le fichier choisi avec la passphrase saisie.
     */
    protected async submitImport(passphrase: string): Promise<void> {
        if (this.busy()) {
            return;
        }

        this.busy.set(true);
        this.importError.set(null);

        try {
            const count = await this.connections.importProfiles(passphrase);
            this.importPrompt.set(false);

            // 0 : l'utilisateur a fermé le sélecteur de fichier sans rien choisir.
            if (count > 0) {
                this.selectFirst();
                await this.toast(this.i18n.t("connections.importDone", { count }));
            }
        }
        catch {
            this.importError.set(this.i18n.t("connections.wrongPassphrase"));
        }
        finally {
            this.busy.set(false);
        }
    }

    /**
     * Nom affiché du driver d'un profil.
     */
    protected driverLabel(profile: ConnectionProfile): string {
        return this.driverInfos().find(driver => driver.type === profile.driverType)?.displayName ?? profile.driverType;
    }

    private async tryUnlock(masterPassword: string): Promise<boolean> {
        try {
            const ok = await this.connections.unlock(masterPassword);

            if (ok) {
                this.enterManager();
            }

            return ok;
        }
        catch {
            return false;
        }
    }

    private enterManager(): void {
        this.view.set("manager");
        this.selectFirst();
    }

    /** Sélectionne le premier profil de l'arbre, ou affiche l'état vide. */
    private selectFirst(): void {
        const first = this.tree().find(node => node.profiles.length > 0)?.profiles[0] ?? null;
        this.selectedProfileId.set(first?.id ?? null);
        this.mode.set("view");
    }

    private openForm(profile: ConnectionProfile | null): void {
        this.editingProfile.set(profile);
        this.formSession.update(session => session + 1);
        this.mode.set("edit");
    }

    private async confirmDanger(title: string, message: string, confirmText: string, action: () => Promise<void>): Promise<void> {
        await this.alertCtrl.create({
            title,
            message,
            color: "danger",
            actions: [
                { text: this.i18n.t("editor.cancel"), role: "cancel" },
                {
                    text: confirmText,
                    role: "destructive",
                    color: "danger",
                    handler: self => {
                        self.dismiss({ role: "destructive" });
                        void this.runBusy(action);
                    },
                },
            ],
        });
    }

    /** Exécute une opération en bloquant les actions, et affiche l'erreur éventuelle en toast. */
    private async runBusy(action: () => Promise<void>): Promise<void> {
        this.busy.set(true);

        try {
            await action();
        }
        catch (err) {
            await this.toast(extractIpcErrorMessage(err), "danger");
        }
        finally {
            this.busy.set(false);
        }
    }

    private async toast(message: string, color?: UIColor): Promise<void> {
        await this.toastCtrl.create({ message, duration: 3000, color });
    }

}
