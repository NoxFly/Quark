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
    afterNextRender,
    ChangeDetectionStrategy,
    Component,
    computed,
    type ElementRef,
    inject,
    input,
    output,
    signal,
    viewChild,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import type { VaultGateMode } from "src/app/core/models/connections.model";
import { ConnectionsService } from "src/app/core/services/connections.service";
import { I18nService } from "src/app/core/services/i18n.service";
import { MIN_MASTER_PASSWORD_LENGTH } from "src/app/shared/helpers/connections.helper";
import { extractIpcErrorMessage } from "src/app/shared/helpers/utils";
import { TranslatePipe } from "src/app/shared/pipes/translate.pipe";

/**
 * Accès au coffre de connexions : définition du mot de passe maître (premier usage)
 * ou déverrouillage. Émet `opened` une fois le coffre accessible.
 */
@Component({
    selector: "app-vault-gate",
    standalone: true,
    templateUrl: "./vault-gate.component.html",
    styleUrl: "./vault-gate.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, TranslatePipe],
})
export class VaultGateComponent {
    private readonly connections = inject(ConnectionsService);
    private readonly i18n = inject(I18nService);

    public readonly mode = input.required<VaultGateMode>();

    public readonly opened = output<void>();
    public readonly cancelled = output<void>();

    protected readonly minLength = MIN_MASTER_PASSWORD_LENGTH;
    protected readonly password = signal<string>("");
    protected readonly confirmation = signal<string>("");
    protected readonly errorMessage = signal<string | null>(null);
    protected readonly busy = signal<boolean>(false);

    protected readonly canSubmit = computed<boolean>(() => {
        if (this.busy()) {
            return false;
        }

        if (this.mode() === "unlock") {
            return this.password() !== "";
        }

        return this.password().length >= MIN_MASTER_PASSWORD_LENGTH && this.password() === this.confirmation();
    });

    private readonly passwordInput = viewChild<ElementRef<HTMLInputElement>>("passwordInput");

    public constructor() {
        afterNextRender(() => this.passwordInput()?.nativeElement.focus());
    }

    /**
     * Crée le coffre ou le déverrouille avec le mot de passe saisi.
     */
    protected async submit(): Promise<void> {
        if (!this.canSubmit()) {
            return;
        }

        this.busy.set(true);
        this.errorMessage.set(null);

        try {
            if (this.mode() === "init") {
                await this.connections.initialize(this.password());
                this.opened.emit();
            }
            else if (await this.connections.unlock(this.password())) {
                this.opened.emit();
            }
            else {
                this.errorMessage.set(this.i18n.t("connections.wrongPassword"));
            }
        }
        catch (err) {
            this.errorMessage.set(extractIpcErrorMessage(err));
        }
        finally {
            this.busy.set(false);
        }
    }
}
