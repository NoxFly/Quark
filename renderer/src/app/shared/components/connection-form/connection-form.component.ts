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

import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    input,
    linkedSignal,
    output,
    signal,
    untracked,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import type {
    ConnectionFolder,
    ConnectionProfile,
    ConnectionProfileInput,
    ConnectionTestResult,
} from "@shared/connection";
import type { DatabaseDriverType, DriverInfo } from "@shared/driver";
import type { ConnectionDraft } from "src/app/core/models/connections.model";
import { ConnectionsService } from "src/app/core/services/connections.service";
import { I18nService } from "src/app/core/services/i18n.service";
import { NoxusService } from "src/app/core/services/noxus.service";
import { SettingsService } from "src/app/core/services/settings.service";
import {
    buildProfileInput,
    buildTestBody,
    CONNECTION_TAGS,
    canSubmitDraft,
    DEFAULT_DRAFT_DRIVER,
    defaultPortFor,
    draftFromProfile,
    fileBaseName,
    isServicePrincipalDraft,
    tagColor,
    tagLabelKey,
} from "src/app/shared/helpers/connections.helper";
import { extractIpcErrorMessage } from "src/app/shared/helpers/utils";
import { TranslatePipe } from "src/app/shared/pipes/translate.pipe";
import { DriverThumbComponent } from "src/app/shared/components/connections-manager/driver-thumb/driver-thumb.component";
import { ToastController } from "@ui/toast/toast.controller";

/**
 * Formulaire de création / édition d'un profil de connexion (volet droit du gestionnaire).
 *
 * Les champs suivent le type choisi : fichier ou URL distante (SQLite), URI (MongoDB),
 * hôte / port et identifiants (serveurs), authentification Entra ID (Azure SQL).
 * Le mot de passe est « write-only » : en édition, un champ vide conserve le secret existant.
 */
@Component({
    selector: "app-connection-form",
    standalone: true,
    templateUrl: "./connection-form.component.html",
    styleUrl: "./connection-form.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, TranslatePipe, DriverThumbComponent],
})
export class ConnectionFormComponent {
    private readonly noxus = inject(NoxusService);
    private readonly connections = inject(ConnectionsService);
    private readonly settings = inject(SettingsService);
    private readonly toastCtrl = inject(ToastController);
    private readonly i18n = inject(I18nService);

    /** Profil à éditer ; `null` pour une création. */
    public readonly profile = input<ConnectionProfile | null>(null);
    /** Liste de tous les drivers disponibles. */
    public readonly driverInfos = input<DriverInfo[]>([]);
    /** Dossiers proposés, déjà triés. */
    public readonly folders = input<ConnectionFolder[]>([]);
    /** Dossier présélectionné pour une création. */
    public readonly defaultFolderId = input<string>("");
    /** Incrémenté par le parent à chaque ouverture, pour réinitialiser le brouillon. */
    public readonly session = input<number>(0);
    public readonly busy = input<boolean>(false);

    public readonly save = output<ConnectionProfileInput>();
    public readonly cancel = output<void>();

    protected readonly tags = CONNECTION_TAGS;
    protected readonly tagColor = tagColor;
    protected readonly tagLabelKey = tagLabelKey;

    protected readonly draft = linkedSignal<{ profile: ConnectionProfile | null; session: number }, ConnectionDraft>({
        source: () => ({ profile: this.profile(), session: this.session() }),
        // Les valeurs par défaut sont lues sans dépendance : un rechargement des
        // dossiers ou des réglages ne doit pas effacer la saisie en cours.
        computation: ({ profile }) => untracked(() => draftFromProfile(profile, {
            folderId: this.defaultFolderId(),
            ssl: this.settings.settings().sslByDefault,
            port: defaultPortFor(this.driverInfos(), DEFAULT_DRAFT_DRIVER),
        })),
    });

    protected readonly testing = signal<boolean>(false);

    /** Types proposés en pastilles ; libSQL est le mode « URL distante » de SQLite. */
    protected readonly driverTypes = computed<DriverInfo[]>(() =>
        this.driverInfos().filter(driver => driver.type !== "libsql"),
    );

    protected readonly isEditing = computed<boolean>(() => this.profile() !== null);
    protected readonly hasStoredPassword = computed<boolean>(() => this.profile()?.hasPassword ?? false);
    protected readonly isSqlite = computed<boolean>(() => this.draft().driverType === "sqlite");
    protected readonly isSqliteFile = computed<boolean>(() => this.isSqlite() && this.draft().sqliteMode === "file");
    protected readonly isMongo = computed<boolean>(() => this.draft().driverType === "mongodb");
    protected readonly isServer = computed<boolean>(() => !this.isSqlite() && !this.isMongo());
    protected readonly isAzure = computed<boolean>(() => this.draft().driverType === "azure");
    protected readonly isServicePrincipal = computed<boolean>(() => isServicePrincipalDraft(this.draft()));
    protected readonly canSubmit = computed<boolean>(() => canSubmitDraft(this.draft(), this.hasStoredPassword()));

    protected readonly passwordPlaceholder = computed<string>(() => {
        if (this.hasStoredPassword()) {
            return this.i18n.t("connections.form.passwordUnchanged");
        }

        return this.isSqliteFile() ? this.i18n.t("connections.form.passwordOptional") : "";
    });

    /**
     * Modifie un champ du brouillon.
     */
    protected patch<K extends keyof ConnectionDraft>(key: K, value: ConnectionDraft[K]): void {
        this.draft.update(draft => ({ ...draft, [key]: value }));
    }

    /**
     * Change le type : le port revient à celui du nouveau driver.
     */
    protected selectType(type: DatabaseDriverType): void {
        const port = defaultPortFor(this.driverInfos(), type);
        this.draft.update(draft => ({ ...draft, driverType: type, port }));
    }

    /**
     * Saisie du port : les caractères non numériques donnent 0 plutôt que NaN.
     */
    protected setPort(value: string): void {
        const port = Number.parseInt(value, 10);
        this.patch("port", Number.isFinite(port) ? port : 0);
    }

    /**
     * Ouvre le sélecteur de fichier natif (SQLite, fichier local).
     */
    protected async pickFile(): Promise<void> {
        const path = await this.noxus.ipc.openFileDialog();

        if (!path) {
            return;
        }

        const name = this.draft().name.trim() || fileBaseName(path);
        this.draft.update(draft => ({ ...draft, filePath: path, name }));
    }

    /**
     * Teste la connexion saisie : toast d'attente, puis résultat.
     */
    protected async test(): Promise<void> {
        if (this.testing()) {
            return;
        }

        this.testing.set(true);

        // En édition, un mot de passe laissé vide signifie « inchangé » : le main
        // complète alors le test avec le secret stocké du profil.
        const body = buildTestBody(this.draft(), this.settings.settings().connectionTimeout, this.profile()?.id);
        const pending = await this.toastCtrl.create({ message: this.i18n.t("connections.test.running"), busy: true });
        let result: ConnectionTestResult;

        try {
            result = await this.connections.testConnection(body);
        }
        catch (err) {
            result = { ok: false, error: extractIpcErrorMessage(err) };
        }
        finally {
            pending.dismiss();
            this.testing.set(false);
        }

        await this.showTestResult(result);
    }

    /**
     * Émet le profil saisi vers le parent.
     */
    protected submit(): void {
        if (!this.canSubmit() || this.busy()) {
            return;
        }

        this.save.emit(buildProfileInput(this.draft(), this.isEditing()));
    }

    private async showTestResult(result: ConnectionTestResult): Promise<void> {
        if (result.ok) {
            const ms = Math.round(result.latencyMs ?? 0);
            await this.toastCtrl.create({
                message: this.i18n.t("connections.test.success", { ms }),
                duration: 3000,
                color: "success",
            });
            return;
        }

        // L'erreur du driver est souvent longue : elle reste affichée plus longtemps.
        await this.toastCtrl.create({
            message: this.i18n.t("connections.test.failure", { error: result.error ?? "" }),
            duration: 6000,
            color: "danger",
        });
    }
}
