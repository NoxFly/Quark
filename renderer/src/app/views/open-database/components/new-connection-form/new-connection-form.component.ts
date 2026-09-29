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

import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from "@angular/core";
import { FormsModule } from "@angular/forms";
import type { AzureAuthMode, SqliteSourceMode } from "@shared/connection";
import { ButtonComponent } from "@ui/button/button.component";
import { SelectComponent } from "@ui/select/select.component";
import { SelectOptionComponent } from "@ui/select/select-option/select-option.component";
import { ToastController } from "@ui/toast/toast.controller";
import type { DriverPresentation } from "src/app/core/models/driver-presentation.model";
import type { NewConnectionDraft, NewConnectionTextField } from "src/app/core/models/new-connection.model";
import { ConnectionsService } from "src/app/core/services/connections.service";
import { DatabaseService } from "src/app/core/services/database.service";
import { I18nService } from "src/app/core/services/i18n.service";
import { NoxusService } from "src/app/core/services/noxus.service";
import { SettingsService } from "src/app/core/services/settings.service";
import { extractIpcErrorMessage } from "src/app/shared/helpers/utils";
import { TranslatePipe } from "src/app/shared/pipes/translate.pipe";
import {
    buildNetworkBody,
    buildProfileInput,
    buildRemoteSqliteBody,
    buildTestBody,
    createDraft,
    isDraftComplete,
    usesServicePrincipal,
} from "src/app/views/open-database/components/new-connection-form/new-connection.helper";

/**
 * Formulaire « Nouvelle connexion » affiché sous les cartes de la page d'accueil,
 * pour le type de base sélectionné : fichier / URL distante (SQLite), URI (MongoDB)
 * ou serveur (hôte, port, identifiants, SSL, authentification Azure).
 * Propose de tester la connexion et de l'enregistrer dans le gestionnaire.
 */
@Component({
    selector: "app-new-connection-form",
    standalone: true,
    templateUrl: "./new-connection-form.component.html",
    styleUrl: "./new-connection-form.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, TranslatePipe, ButtonComponent, SelectComponent, SelectOptionComponent],
})
export class NewConnectionFormComponent {
    private readonly dbService = inject(DatabaseService);
    private readonly connections = inject(ConnectionsService);
    private readonly settings = inject(SettingsService);
    private readonly noxus = inject(NoxusService);
    private readonly toastCtrl = inject(ToastController);
    private readonly i18n = inject(I18nService);

    public readonly driver = input.required<DriverPresentation>();

    protected readonly draft = signal<NewConnectionDraft>(createDraft(null, this.settings.settings().sslByDefault));
    protected readonly connecting = signal<boolean>(false);
    protected readonly testing = signal<boolean>(false);
    protected readonly error = signal<string | null>(null);

    /** « Enregistrer dans le gestionnaire de connexions ». */
    protected readonly saveProfile = signal<boolean>(false);
    protected readonly masterPassword = signal<string>("");

    protected readonly isServicePrincipal = computed<boolean>(() => usesServicePrincipal(this.driver(), this.draft()));
    protected readonly canSubmit = computed<boolean>(() => isDraftComplete(this.driver(), this.draft()));
    protected readonly busy = computed<boolean>(() => this.connecting() || this.testing());

    /** Le mot de passe maître n'est demandé que si le coffre n'est pas déjà ouvert. */
    protected readonly needsMasterPassword = computed<boolean>(() => this.saveProfile() && !this.connections.status().unlocked);
    protected readonly vaultInitialized = computed<boolean>(() => this.connections.status().initialized);

    public constructor() {
        // Un autre type de base repart d'un formulaire vierge (port par défaut du driver).
        effect(() => {
            const driver = this.driver();
            untracked(() => {
                this.draft.set(createDraft(driver.defaultPort, this.settings.settings().sslByDefault));
                this.error.set(null);
            });
        });
    }

    /**
     * Met à jour un champ texte du brouillon.
     */
    protected onTextInput(field: NewConnectionTextField, event: Event): void {
        const value = (event.target as HTMLInputElement).value;
        this.draft.update(draft => ({ ...draft, [field]: value }));
        this.error.set(null);
    }

    /**
     * Met à jour le port (entier positif).
     */
    protected onPortInput(event: Event): void {
        const parsed = Number.parseInt((event.target as HTMLInputElement).value, 10);
        const port = Number.isNaN(parsed) ? 0 : parsed;
        this.draft.update(draft => ({ ...draft, port }));
    }

    /**
     * Coche / décoche SSL / TLS.
     */
    protected onSslChange(event: Event): void {
        const ssl = (event.target as HTMLInputElement).checked;
        this.draft.update(draft => ({ ...draft, ssl }));
    }

    /**
     * Change le mode d'authentification Azure.
     */
    protected setAuthMode(authMode: AzureAuthMode): void {
        this.draft.update(draft => ({ ...draft, authMode }));
    }

    /**
     * Bascule SQLite entre fichier local et URL distante.
     */
    protected setSqliteMode(sqliteMode: SqliteSourceMode): void {
        this.draft.update(draft => ({ ...draft, sqliteMode }));
        this.error.set(null);
    }

    /**
     * Coche « Enregistrer dans le gestionnaire » et relit l'état du coffre, pour
     * savoir s'il faut demander le mot de passe maître.
     */
    protected async onSaveProfileChange(event: Event): Promise<void> {
        const checked = (event.target as HTMLInputElement).checked;
        this.saveProfile.set(checked);

        if (checked) {
            await this.connections.refreshStatus();
        }
    }

    /**
     * Met à jour le mot de passe maître saisi.
     */
    protected onMasterPasswordInput(event: Event): void {
        this.masterPassword.set((event.target as HTMLInputElement).value);
    }

    /**
     * Choisit le fichier SQLite via le dialogue natif (sans l'ouvrir).
     */
    protected async browseFile(): Promise<void> {
        const filePath = await this.noxus.ipc.openFileDialog();

        if (filePath) {
            this.draft.update(draft => ({ ...draft, filePath }));
        }
    }

    /**
     * Teste la connexion sans l'ouvrir : toast d'attente puis résultat.
     */
    protected async test(): Promise<void> {
        if (!this.canSubmit() || this.busy()) {
            return;
        }

        this.testing.set(true);
        const pending = await this.toastCtrl.create({ message: this.i18n.t("home.toast.testing"), busy: true });

        try {
            const body = buildTestBody(this.driver(), this.draft(), this.settings.settings().connectionTimeout);
            const result = await this.dbService.testConnection(body);
            pending.dismiss();

            if (result.ok) {
                const message = this.i18n.t("home.toast.testOk", { ms: result.latencyMs ?? 0 });
                await this.toastCtrl.create({ message, duration: 3000, color: "success" });
            }
            else {
                const message = this.i18n.t("home.toast.testFailed", { error: result.error ?? "" });
                await this.toastCtrl.create({ message, duration: 5000, color: "danger", closable: true });
            }
        }
        finally {
            this.testing.set(false);
        }
    }

    /**
     * Ouvre la connexion dans la fenêtre, puis l'enregistre dans le gestionnaire si demandé.
     */
    protected async connect(): Promise<void> {
        if (!this.canSubmit() || this.busy()) {
            return;
        }

        this.connecting.set(true);
        this.error.set(null);

        try {
            // Le coffre est ouvert avant la connexion : un mot de passe maître erroné
            // doit être corrigé ici, pas découvert une fois la page quittée.
            if (this.saveProfile() && !(await this.ensureVaultUnlocked())) {
                return;
            }

            await this.openConnection();

            if (this.saveProfile()) {
                await this.createProfile();
            }
        }
        catch (err) {
            this.error.set(extractIpcErrorMessage(err));
        }
        finally {
            this.connecting.set(false);
        }
    }

    /**
     * Valide la saisie par Entrée depuis n'importe quel champ.
     */
    protected onFieldKeydown(event: KeyboardEvent): void {
        if (event.key === "Enter") {
            event.preventDefault();
            void this.connect();
        }
    }

    private async openConnection(): Promise<void> {
        const driver = this.driver();
        const draft = this.draft();
        const timeoutSeconds = this.settings.settings().connectionTimeout;

        if (driver.form !== "file") {
            await this.dbService.connectNetwork(buildNetworkBody(driver, draft, timeoutSeconds));
        }
        else if (draft.sqliteMode === "url") {
            await this.dbService.connectRemoteSqlite(buildRemoteSqliteBody(draft, timeoutSeconds));
        }
        else {
            await this.dbService.openFile(draft.filePath.trim());
        }
    }

    /**
     * Déverrouille (ou crée) le coffre avec le mot de passe maître saisi.
     * @returns `false` si le mot de passe est refusé ou manquant.
     */
    private async ensureVaultUnlocked(): Promise<boolean> {
        const status = await this.connections.refreshStatus();

        if (status.unlocked) {
            return true;
        }

        const masterPassword = this.masterPassword();

        if (!masterPassword) {
            this.error.set(this.i18n.t("home.form.masterPasswordRequired"));
            return false;
        }

        if (!status.initialized) {
            await this.connections.initialize(masterPassword);
            return true;
        }

        const unlocked = await this.connections.unlock(masterPassword);

        if (!unlocked) {
            this.error.set(this.i18n.t("home.form.wrongMasterPassword"));
        }

        return unlocked;
    }

    /**
     * Crée le profil : la connexion est déjà ouverte, un échec n'est donc que signalé.
     */
    private async createProfile(): Promise<void> {
        try {
            await this.connections.create(buildProfileInput(this.driver(), this.draft()));
            await this.toastCtrl.create({ message: this.i18n.t("home.toast.profileSaved"), duration: 3000, color: "success" });
        }
        catch (err) {
            const message = this.i18n.t("home.toast.profileFailed", { error: extractIpcErrorMessage(err) });
            await this.toastCtrl.create({ message, duration: 5000, color: "danger", closable: true });
        }
    }
}
