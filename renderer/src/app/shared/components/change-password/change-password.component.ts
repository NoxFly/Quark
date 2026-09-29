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

import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ButtonComponent } from "@ui/button/button.component";
import { InputComponent } from "@ui/input/input.component";
import { DatabaseService } from "src/app/core/services/database.service";
import { I18nService } from "src/app/core/services/i18n.service";
import { NoxusService } from "src/app/core/services/noxus.service";
import { StateService } from "src/app/core/services/state.service";
import { isEncryptedFile } from "src/app/shared/helpers/database-encryption.helper";
import { extractIpcErrorMessage } from "src/app/shared/helpers/utils";

/** Longueur minimale d'un nouveau mot de passe. */
const MIN_PASSWORD_LENGTH = 4;

/**
 * Modale « Chiffrement » d'une base SQLite :
 * - chiffrer une base qui ne l'est pas ;
 * - changer le mot de passe d'une base chiffrée ;
 * - retirer le chiffrement (après une confirmation en place).
 *
 * L'état de chiffrement vient de la liste des bases récentes ; s'il est inconnu,
 * les deux actions restent proposées avec un texte neutre.
 */
@Component({
    selector: "app-change-password",
    standalone: true,
    templateUrl: "./change-password.component.html",
    styleUrl: "./change-password.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, ButtonComponent, InputComponent],
})
export class ChangePasswordComponent implements OnInit {
    private readonly dbService = inject(DatabaseService);
    private readonly noxus = inject(NoxusService);
    private readonly state = inject(StateService);
    protected readonly i18n = inject(I18nService);

    /** Callback de fermeture. */
    public dismiss?: (data?: { changed: boolean } | null) => void;

    /** La base est chiffrée (`null` : inconnu). */
    protected readonly encrypted = signal<boolean | null>(null);

    protected readonly newPassword = signal<string>("");
    protected readonly confirmPassword = signal<string>("");
    protected readonly isSaving = signal<boolean>(false);
    protected readonly errorMessage = signal<string | null>(null);

    /** Le retrait du chiffrement attend une seconde confirmation. */
    protected readonly removeArmed = signal<boolean>(false);

    /** Action aboutie, `null` tant qu'aucune ne l'est. */
    protected readonly done = signal<"set" | "remove" | null>(null);

    protected readonly passwordsMatch = computed(() => this.newPassword() === this.confirmPassword());

    protected readonly canSetPassword = computed(() => {
        return !this.isSaving() && this.newPassword().length >= MIN_PASSWORD_LENGTH && this.passwordsMatch();
    });

    /** Texte d'explication, selon l'état de chiffrement connu. */
    protected readonly descriptionKey = computed(() => {
        switch (this.encrypted()) {
            case true: return "changePassword.encryptedDescription";
            case false: return "changePassword.plainDescription";
            default: return "changePassword.unknownDescription";
        }
    });

    /** Libellé du bouton principal : chiffrer une base en clair, sinon changer le mot de passe. */
    protected readonly setLabelKey = computed(() => {
        return this.encrypted() === false ? "changePassword.encrypt" : "changePassword.change";
    });

    /**
     *
     */
    public async ngOnInit(): Promise<void> {
        try {
            const recents = await this.noxus.ipc.getRecentDatabases();
            this.encrypted.set(isEncryptedFile(recents, this.state.filePath()));
        }
        catch {
            // État inconnu : les deux actions restent proposées.
        }
    }

    /**
     * Chiffre la base ou change son mot de passe.
     */
    protected async setPassword(): Promise<void> {
        if (!this.canSetPassword()) {
            return;
        }

        await this.apply(this.newPassword(), "set");
    }

    /**
     * Retire le chiffrement au second clic : le premier affiche l'avertissement.
     */
    protected async removeEncryption(): Promise<void> {
        if (!this.removeArmed()) {
            this.removeArmed.set(true);
            return;
        }

        await this.apply(null, "remove");
    }

    protected close(): void {
        this.dismiss?.({ changed: this.done() !== null });
    }

    /**
     * Applique le nouveau mot de passe (`null` retire le chiffrement).
     */
    private async apply(password: string | null, action: "set" | "remove"): Promise<void> {
        this.isSaving.set(true);
        this.errorMessage.set(null);

        try {
            await this.dbService.changePassword(password);
            this.done.set(action);
        }
        catch (err) {
            this.errorMessage.set(extractIpcErrorMessage(err));
        }
        finally {
            this.isSaving.set(false);
        }
    }
}
