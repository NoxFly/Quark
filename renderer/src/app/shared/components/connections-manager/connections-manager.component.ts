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

import { ChangeDetectionStrategy, Component, computed, inject, type OnInit, signal } from "@angular/core";
import type { ConnectionFolder, ConnectionProfile, ConnectionProfileInput } from "@shared/connection";
import type { DriverInfo } from "@shared/driver";
import type {
    ConnectionFolderNode,
    ConnectionsManagerView,
    ConnectionsPaneMode,
    SecretPromptRequest,
} from "src/app/core/models/connections.model";
import { ConnectionsService } from "src/app/core/services/connections.service";
import { I18nService } from "src/app/core/services/i18n.service";
import { NoxusService } from "src/app/core/services/noxus.service";
import {
    groupProfilesByFolder,
    MIN_MASTER_PASSWORD_LENGTH,
    sortFolders,
} from "src/app/shared/helpers/connections.helper";
import { extractIpcErrorMessage } from "src/app/shared/helpers/utils";
import { TranslatePipe } from "src/app/shared/pipes/translate.pipe";
import { ConnectionFormComponent } from "src/app/shared/components/connection-form/connection-form.component";
import { ConnectionDetailsComponent } from "src/app/shared/components/connections-manager/connection-details/connection-details.component";
import { ConnectionTreeComponent } from "src/app/shared/components/connections-manager/connection-tree/connection-tree.component";
import { ConnectionFolderFormComponent } from "src/app/shared/components/connections-manager/folder-form/folder-form.component";
import { SecretPromptComponent } from "src/app/shared/components/connections-manager/secret-prompt/secret-prompt.component";
import { VaultGateComponent } from "src/app/shared/components/connections-manager/vault-gate/vault-gate.component";
import { AlertController } from "@ui/alert/alert.controller";
import { ToastController } from "@ui/toast/toast.controller";
import type { UIColor } from "src/app/shared/ui/ui.types";

/**
 * Gestionnaire de connexions sauvegardées (Fichier > Connexions).
 *
 * Orchestre les états du coffre chiffré (création du mot de passe maître, déverrouillage),
 * l'arbre dossiers / profils, le volet de droite (fiche, formulaire, dossier) et les saisies
 * secrètes (passphrase d'export / d'import, bascule du mot de passe maître).
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

    protected readonly minMasterLength = MIN_MASTER_PASSWORD_LENGTH;

    protected readonly view = signal<ConnectionsManagerView>("loading");
    protected readonly mode = signal<ConnectionsPaneMode>("view");
    protected readonly driverInfos = signal<DriverInfo[]>([]);
    protected readonly selectedProfileId = signal<string | null>(null);
    protected readonly selectedFolderId = signal<string | null>(null);
    protected readonly editingProfile = signal<ConnectionProfile | null>(null);
    protected readonly formSession = signal<number>(0);
    protected readonly busy = signal<boolean>(false);

    protected readonly secretPrompt = signal<SecretPromptRequest | null>(null);
    protected readonly secretError = signal<string | null>(null);

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
     * Annule le formulaire ou l'édition de dossier et revient au contexte précédent.
     */
    protected cancelPane(): void {
        const backToFolder = this.selectedFolderId() !== null && this.selectedProfileId() === null;
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
     * Ouvre une saisie secrète : passphrase d'export / d'import, ou bascule du mot de passe maître.
     */
    protected openSecretPrompt(kind: SecretPromptRequest["kind"]): void {
        const profile = this.selectedProfile();
        const ids = kind === "export" && profile ? [profile.id] : [];

        this.secretError.set(null);
        this.secretPrompt.set({ kind, ids });
    }

    /**
     * Bascule l'interrupteur « Mot de passe maître ».
     */
    protected toggleMasterPassword(): void {
        this.openSecretPrompt(this.masterEnabled() ? "disable-master" : "enable-master");
    }

    /**
     * Exécute l'action de la saisie secrète validée.
     */
    protected async submitSecret(secret: string): Promise<void> {
        const prompt = this.secretPrompt();

        if (!prompt || this.busy()) {
            return;
        }

        this.busy.set(true);
        this.secretError.set(null);

        try {
            const message = await this.runSecretAction(prompt, secret);
            this.secretPrompt.set(null);

            if (message) {
                await this.toast(message);
            }
        }
        catch (err) {
            this.secretError.set(this.secretErrorMessage(prompt, err));
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

    /**
     * Libellé d'une clé i18n propre au type de saisie secrète (`title`, `hint`, `label`, `submit`).
     */
    protected secretText(field: string): string {
        const kind = this.secretPrompt()?.kind ?? "import";
        return this.i18n.t(`connections.secret.${kind}.${field}`);
    }

    private async runSecretAction(prompt: SecretPromptRequest, secret: string): Promise<string | null> {
        switch (prompt.kind) {
            case "export": {
                const written = await this.connections.exportProfiles(prompt.ids, secret);
                return written ? this.i18n.t("connections.exportDone") : null;
            }
            case "import": {
                const count = await this.connections.importProfiles(secret);
                this.selectFirst();
                return this.i18n.t("connections.importDone", { count });
            }
            case "enable-master":
                await this.connections.setMasterPassword(true, secret);
                return this.i18n.t("connections.master.enabled");
            case "disable-master":
                await this.connections.setMasterPassword(false, secret);
                return this.i18n.t("connections.master.disabled");
        }
    }

    private secretErrorMessage(prompt: SecretPromptRequest, err: unknown): string {
        if (prompt.kind === "export" || prompt.kind === "import") {
            return this.i18n.t("connections.wrongPassphrase");
        }

        if (prompt.kind === "disable-master") {
            return this.i18n.t("connections.wrongPassword");
        }

        return extractIpcErrorMessage(err);
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
