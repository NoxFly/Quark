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

import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ButtonComponent } from "@ui/button/button.component";
import { InputComponent } from "@ui/input/input.component";
import { ConnectionsService } from "src/app/core/services/connections.service";
import { NoxusService } from "src/app/core/services/noxus.service";
import { TranslatePipe } from "src/app/shared/pipes/translate.pipe";

/** Longueur minimale d'un nouveau mot de passe maître. */
const MIN_PASSWORD_LENGTH = 4;

/**
 * Petite modale du réglage « Mot de passe maître ».
 *
 * - activation : saisie (et confirmation) du nouveau mot de passe maître ;
 * - désactivation : saisie du mot de passe actuel, qui prouve que l'utilisateur
 *   a le droit de retirer la protection du coffre.
 */
@Component({
    selector: "app-master-password-dialog",
    standalone: true,
    templateUrl: "./master-password-dialog.component.html",
    styleUrl: "./master-password-dialog.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, ButtonComponent, InputComponent, TranslatePipe],
})
export class MasterPasswordDialogComponent {
    private readonly noxus = inject(NoxusService);
    private readonly connections = inject(ConnectionsService);

    /** `true` pour activer la protection, `false` pour la retirer. */
    public readonly enable = input<boolean>(true);

    /** Callback de fermeture, fourni par l'ouvreur de la modale. */
    public dismiss?: (changed: boolean) => void;

    protected readonly password = signal<string>("");
    protected readonly confirmation = signal<string>("");
    protected readonly saving = signal<boolean>(false);
    protected readonly error = signal<string | null>(null);

    protected readonly mismatch = computed<boolean>(() =>
        this.enable() && this.confirmation() !== "" && this.confirmation() !== this.password());

    protected readonly canSubmit = computed<boolean>(() => {
        if (this.saving()) {
            return false;
        }

        return this.enable()
            ? this.password().length >= MIN_PASSWORD_LENGTH && this.password() === this.confirmation()
            : this.password() !== "";
    });

    protected async submit(): Promise<void> {
        if (!this.canSubmit()) {
            return;
        }

        this.saving.set(true);
        this.error.set(null);

        try {
            await this.noxus.ipc.connSetMasterPassword({ enabled: this.enable(), masterPassword: this.password() });
            await this.connections.refreshStatus();
            this.dismiss?.(true);
        }
        catch (error) {
            this.error.set(error instanceof Error ? error.message : String(error));
        }
        finally {
            this.saving.set(false);
        }
    }

    protected cancel(): void {
        this.dismiss?.(false);
    }
}
