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
    input,
    output,
    signal,
    viewChild,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { TranslatePipe } from "src/app/shared/pipes/translate.pipe";

/**
 * Petite modale de saisie secrète, superposée au gestionnaire de connexions :
 * passphrase d'export / d'import, activation ou désactivation du mot de passe maître.
 * Avec `confirmLabel`, un second champ de confirmation doit être identique.
 */
@Component({
    selector: "app-secret-prompt",
    standalone: true,
    templateUrl: "./secret-prompt.component.html",
    styleUrl: "./secret-prompt.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, TranslatePipe],
})
export class SecretPromptComponent {
    public readonly title = input.required<string>();
    public readonly hint = input<string>("");
    public readonly label = input.required<string>();
    /** Libellé du champ de confirmation ; absent : pas de confirmation. */
    public readonly confirmLabel = input<string | null>(null);
    public readonly minLength = input<number>(1);
    public readonly submitLabel = input.required<string>();
    public readonly error = input<string | null>(null);
    public readonly busy = input<boolean>(false);
    /** Saisie d'un nouveau secret (gestionnaire de mots de passe : `new-password`). */
    public readonly isNewSecret = input<boolean>(false);

    public readonly submitted = output<string>();
    public readonly cancelled = output<void>();

    protected readonly secret = signal<string>("");
    protected readonly confirmation = signal<string>("");

    protected readonly canSubmit = computed<boolean>(() => {
        const secret = this.secret();

        if (secret.length < this.minLength() || this.busy()) {
            return false;
        }

        return this.confirmLabel() === null || secret === this.confirmation();
    });

    private readonly secretInput = viewChild<ElementRef<HTMLInputElement>>("secretInput");

    public constructor() {
        afterNextRender(() => this.secretInput()?.nativeElement.focus());
    }

    /**
     * Émet le secret saisi s'il est valide.
     */
    protected submit(): void {
        if (!this.canSubmit()) {
            return;
        }

        this.submitted.emit(this.secret());
    }
}
