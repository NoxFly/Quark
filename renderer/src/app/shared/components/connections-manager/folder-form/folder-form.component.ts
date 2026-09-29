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
    afterRenderEffect,
    ChangeDetectionStrategy,
    Component,
    computed,
    type ElementRef,
    input,
    linkedSignal,
    output,
    viewChild,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import type { ConnectionFolderNode } from "src/app/core/models/connections.model";
import { TranslatePipe } from "src/app/shared/pipes/translate.pipe";

/**
 * Création / renommage / suppression d'un dossier du gestionnaire de connexions.
 */
@Component({
    selector: "app-connection-folder-form",
    standalone: true,
    templateUrl: "./folder-form.component.html",
    styleUrl: "./folder-form.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, TranslatePipe],
})
export class ConnectionFolderFormComponent {
    /** Dossier renommé ; `null` pour une création (ou le nœud virtuel « Non classées »). */
    public readonly folder = input<ConnectionFolderNode | null>(null);
    public readonly busy = input<boolean>(false);

    public readonly saved = output<string>();
    public readonly deleteRequested = output<void>();
    public readonly cancelled = output<void>();

    protected readonly existing = computed<boolean>(() => {
        const folder = this.folder();
        return folder !== null && !folder.virtual;
    });

    /** Nom saisi, réinitialisé à chaque changement de dossier. */
    protected readonly name = linkedSignal<string>(() => (this.existing() ? (this.folder()?.name ?? "") : ""));

    private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>("nameInput");

    public constructor() {
        // Le focus suit le dossier sélectionné : le composant est réutilisé d'un dossier à l'autre.
        afterRenderEffect(() => {
            this.folder();
            this.nameInput()?.nativeElement.focus();
        });
    }

    /**
     * Valide le nom saisi (bouton ou touche Entrée).
     */
    protected submit(): void {
        const name = this.name().trim();

        if (!name || this.busy()) {
            return;
        }

        this.saved.emit(name);
    }
}
