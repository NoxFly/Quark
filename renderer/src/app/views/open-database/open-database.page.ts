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

import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import type { DriverPresentation } from "src/app/core/models/driver-presentation.model";
import { DatabaseService } from "src/app/core/services/database.service";
import { NoxusService } from "src/app/core/services/noxus.service";
import { HOME_DRIVERS } from "src/app/shared/helpers/driver-presentation.helper";
import { TranslatePipe } from "src/app/shared/pipes/translate.pipe";
import { HomeSidebarComponent } from "src/app/views/open-database/components/home-sidebar/home-sidebar.component";
import { NewConnectionFormComponent } from "src/app/views/open-database/components/new-connection-form/new-connection-form.component";

/**
 * Page d'accueil (aucune base ouverte) : bases récentes et gestionnaire à gauche,
 * cartes des types de base et formulaire « Nouvelle connexion » à droite.
 * Un fichier déposé sur la page est ouvert en SQLite (Ctrl+O est géré par `AppComponent`).
 * La demande de mot de passe d'une base chiffrée est la modale `app-password-prompt`.
 */
@Component({
    selector: "app-open-database",
    standalone: true,
    templateUrl: "./open-database.page.html",
    styleUrl: "./open-database.page.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [TranslatePipe, HomeSidebarComponent, NewConnectionFormComponent],
    host: {
        "[class.dragging]": "isDragging()",
        "(dragover)": "onDragOver($event)",
        "(dragleave)": "onDragLeave($event)",
        "(drop)": "onDrop($event)",
    },
})
export class OpenDatabasePage {
    private readonly dbService = inject(DatabaseService);
    private readonly noxus = inject(NoxusService);

    protected readonly drivers = HOME_DRIVERS;
    protected readonly selected = signal<DriverPresentation | null>(null);
    protected readonly isDragging = signal<boolean>(false);

    /**
     * Sélectionne un type de base et affiche son formulaire.
     */
    protected select(driver: DriverPresentation): void {
        this.selected.set(driver);
    }

    protected onDragOver(event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.isDragging.set(true);
    }

    protected onDragLeave(event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();

        // `dragleave` est aussi émis en passant d'un enfant à l'autre : seule la sortie de la page compte.
        const target = event.relatedTarget as Node | null;
        const host = event.currentTarget as HTMLElement | null;

        if (!target || !host?.contains(target)) {
            this.isDragging.set(false);
        }
    }

    protected async onDrop(event: DragEvent): Promise<void> {
        event.preventDefault();
        event.stopPropagation();
        this.isDragging.set(false);

        const file = event.dataTransfer?.files[0];

        if (!file) {
            return;
        }

        const filePath = this.noxus.ipc.getFilePathFromDrop(file);

        if (filePath) {
            await this.dbService.openFile(filePath);
        }
    }
}
