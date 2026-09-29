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
    effect,
    ElementRef,
    inject,
    OnDestroy,
    OnInit,
    signal,
    viewChild,
} from "@angular/core";
import { ButtonComponent } from "@ui/button/button.component";
import type { RecentDatabaseEntry } from "@shared/ipc-renderer";
import type { PasswordPromptMode } from "src/app/core/models/password-prompt.model";
import { DatabaseService } from "src/app/core/services/database.service";
import { SettingsService } from "src/app/core/services/settings.service";
import { StateService } from "src/app/core/services/state.service";
import { extractIpcErrorMessage } from "src/app/shared/helpers/utils";
import { TranslatePipe } from "src/app/shared/pipes/translate.pipe";
import { IconComponent } from "src/app/shared/ui/components/icon/icon.component";

/**
 * Modale unique de saisie d'un mot de passe d'ouverture.
 *
 * - Base chiffrée : s'affiche d'elle-même tant que `state.needsPassword` est vrai,
 *   quelle que soit l'origine de l'ouverture (dialogue, glisser-déposer, historique,
 *   ligne de commande, profil sans secret, rafraîchissement).
 * - Reconnexion : s'ouvre sur l'événement `open-password-prompt` portant un
 *   `RecentDatabaseEntry` réseau ou distant (le secret n'est jamais conservé).
 *
 * Fermeture : Échap, bouton Annuler, croix ou clic sur le fond.
 */
@Component({
    selector: "app-password-prompt",
    standalone: true,
    imports: [ButtonComponent, TranslatePipe, IconComponent],
    templateUrl: "./password-prompt.component.html",
    styleUrl: "./password-prompt.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        "(window:keydown.escape)": "onEscape()",
    },
})
export class PasswordPromptComponent implements OnInit, OnDestroy {
    private readonly dbService = inject(DatabaseService);
    private readonly settings = inject(SettingsService);
    private readonly state = inject(StateService);

    /** Entrée de l'historique en cours de reconnexion (mode `credentials`). */
    protected readonly entry = signal<RecentDatabaseEntry | null>(null);
    protected readonly password = signal<string>("");
    protected readonly remember = signal<boolean>(false);
    protected readonly busy = signal<boolean>(false);
    /** Clé i18n ou message du driver, `null` sans erreur. */
    protected readonly error = signal<string | null>(null);

    /** La base chiffrée prime : c'est la fenêtre entière qui l'attend. */
    protected readonly mode = computed<PasswordPromptMode | null>(() => {
        if (this.state.needsPassword()) {
            return "encrypted-file";
        }

        return this.entry() ? "credentials" : null;
    });

    /** Nom du fichier chiffré, sans son dossier. */
    protected readonly fileName = computed<string>(() => {
        const path = this.state.pendingFilePath() ?? "";
        return path.split(/[\\/]/).pop() ?? path;
    });

    /** Une base distante demande un jeton, pas un mot de passe. */
    protected readonly isToken = computed<boolean>(() => this.entry()?.connectionType === "remote");

    /** `safeStorage` s'appuie sur le trousseau de Windows (DPAPI), ou sur celui du système ailleurs. */
    protected readonly rememberLabelKey = navigator.userAgent.includes("Windows")
        ? "passwordPrompt.rememberWindows"
        : "passwordPrompt.rememberSystem";

    private readonly passwordInput = viewChild<ElementRef<HTMLInputElement>>("passwordInput");

    private readonly openHandler = (event: Event): void => {
        const detail = (event as CustomEvent<RecentDatabaseEntry>).detail;

        // Un fichier se rouvre simplement : la modale de base chiffrée prend le relais si besoin.
        if (detail.connectionType === "file") {
            void this.dbService.openRecentDatabase(detail);
            return;
        }

        this.reset();
        this.entry.set(detail);
    };

    public constructor() {
        // Champ inséré par le @if : focalisé dès qu'il existe (équivalent d'autofocus).
        effect(() => {
            this.passwordInput()?.nativeElement.focus();
        });
    }

    public ngOnInit(): void {
        document.addEventListener("open-password-prompt", this.openHandler);
    }

    public ngOnDestroy(): void {
        document.removeEventListener("open-password-prompt", this.openHandler);
    }

    /**
     * Met à jour le mot de passe saisi et efface l'erreur précédente.
     */
    protected onPasswordInput(event: Event): void {
        this.password.set((event.target as HTMLInputElement).value);
        this.error.set(null);
    }

    /**
     * Met à jour la case « Mémoriser ».
     */
    protected onRememberChange(event: Event): void {
        this.remember.set((event.target as HTMLInputElement).checked);
    }

    /**
     * Valide la saisie par Entrée.
     */
    protected onInputKeydown(event: KeyboardEvent): void {
        if (event.key === "Enter") {
            event.preventDefault();
            void this.confirm();
        }
    }

    /**
     * Ferme la modale sur Échap.
     */
    protected onEscape(): void {
        if (this.mode() !== null) {
            this.cancel();
        }
    }

    /**
     * Abandonne l'ouverture en cours.
     */
    protected cancel(): void {
        if (this.busy()) {
            return;
        }

        if (this.mode() === "encrypted-file") {
            this.dbService.cancelPasswordRequest();
        }

        this.entry.set(null);
        this.reset();
    }

    /**
     * Déverrouille la base chiffrée ou se reconnecte avec le secret saisi.
     */
    protected async confirm(): Promise<void> {
        const mode = this.mode();

        if (mode === null || this.busy()) {
            return;
        }

        this.busy.set(true);
        this.error.set(null);

        try {
            if (mode === "encrypted-file") {
                await this.unlockFile();
            }
            else {
                await this.reconnect();
            }
        }
        finally {
            this.busy.set(false);
        }
    }

    /**
     * Soumet le mot de passe de la base chiffrée en attente.
     */
    private async unlockFile(): Promise<void> {
        if (!this.password()) {
            return;
        }

        const unlocked = await this.dbService.submitPassword(this.password(), this.remember());

        if (unlocked) {
            this.reset();
        }
        else {
            this.error.set("passwordPrompt.wrongPassword");
        }
    }

    /**
     * Rouvre une connexion réseau ou distante de l'historique avec le secret saisi.
     */
    private async reconnect(): Promise<void> {
        const entry = this.entry();

        if (!entry) {
            return;
        }

        const timeoutSeconds = this.settings.settings().connectionTimeout;

        try {
            if (entry.connectionType === "remote") {
                const authToken = this.password() || undefined;
                await this.dbService.connectRemoteSqlite({ url: entry.url ?? "", authToken, timeoutSeconds });
            }
            else {
                await this.dbService.connectNetwork({
                    driverType: entry.driverType,
                    host: entry.host ?? "",
                    port: entry.port ?? 0,
                    username: entry.username ?? "",
                    password: this.password(),
                    database: entry.database ?? "",
                    timeoutSeconds,
                });
            }

            this.entry.set(null);
            this.reset();
        }
        catch (err) {
            this.error.set(extractIpcErrorMessage(err));
        }
    }

    private reset(): void {
        this.password.set("");
        this.remember.set(false);
        this.error.set(null);
    }
}
