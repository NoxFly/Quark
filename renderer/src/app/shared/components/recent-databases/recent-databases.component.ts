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
    inject,
    signal,
    OnInit,
    OnDestroy,
} from "@angular/core";
import { DatabaseService } from "src/app/core/services/database.service";
import { I18nService } from "src/app/core/services/i18n.service";
import { NoxusService } from "src/app/core/services/noxus.service";
import type { RecentDatabaseEntry } from "@shared/ipc-renderer";

/**
 * Action sheet pour sélectionner une base de données récemment ouverte.
 * S'ouvre via l'événement personnalisé `open-recent-databases` sur le document.
 * Navigation clavier : flèches haut/bas, Enter pour confirmer, Escape pour annuler.
 * Les connexions chiffrées ou réseau déclenchent une demande de mot de passe
 * via l'événement `open-password-prompt`.
 */
@Component({
    selector: "app-recent-databases",
    standalone: true,
    templateUrl: "./recent-databases.component.html",
    styleUrl: "./recent-databases.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        "(window:keydown)": "onKeydown($event)",
        "(click)": "close()",
    },
})
export class RecentDatabasesComponent implements OnInit, OnDestroy {
    private readonly noxus = inject(NoxusService);
    private readonly dbService = inject(DatabaseService);
    protected readonly i18n = inject(I18nService);

    protected readonly isOpen = signal<boolean>(false);
    protected readonly selectedIndex = signal<number>(0);
    protected readonly entries = signal<RecentDatabaseEntry[]>([]);

    private readonly openHandler = (): void => { void this.open(); };

    public ngOnInit(): void {
        document.addEventListener("open-recent-databases", this.openHandler);
    }

    public ngOnDestroy(): void {
        document.removeEventListener("open-recent-databases", this.openHandler);
    }

    /**
     * Ouvre le sélecteur de bases récentes.
     */
    private async open(): Promise<void> {
        const recent = await this.noxus.ipc.getRecentDatabases();
        this.entries.set(recent);
        this.selectedIndex.set(0);
        this.isOpen.set(true);
    }

    /**
     * Ferme le sélecteur sans action.
     */
    protected close(): void {
        this.isOpen.set(false);
    }

    /**
     * Confirme la sélection courante et ouvre la connexion.
     * Délègue au panneau de saisie de mot de passe si nécessaire.
     */
    protected confirm(): void {
        const entry = this.entries()[this.selectedIndex()];
        if (!entry) {
            this.close();
            return;
        }

        this.isOpen.set(false);

        if (entry.requiresPassword) {
            document.dispatchEvent(new CustomEvent("open-password-prompt", { detail: entry }));
            return;
        }

        if (entry.connectionType === "network") {
            // Connexion réseau sans mot de passe
            void this.dbService.connectNetwork({
                driverType: entry.driverType,
                host: entry.host ?? "localhost",
                port: entry.port ?? 0,
                username: entry.username ?? "",
                password: "",
                database: entry.database ?? "",
            });
        }
        else {
            void this.dbService.openFile(entry.filePath ?? "", entry.driverType);
        }
    }

    /**
     * Sélectionne et ouvre une base par clic.
     */
    protected selectEntry(event: MouseEvent, index: number): void {
        event.stopPropagation();
        this.selectedIndex.set(index);
        this.confirm();
    }

    /**
     * Gère la navigation clavier dans la liste.
     */
    protected onKeydown(event: KeyboardEvent): void {
        if (!this.isOpen()) {
            return;
        }

        switch (event.key) {
            case "ArrowDown":
                event.preventDefault();
                this.selectedIndex.update(i => Math.min(i + 1, this.entries().length - 1));
                break;
            case "ArrowUp":
                event.preventDefault();
                this.selectedIndex.update(i => Math.max(i - 1, 0));
                break;
            case "Enter":
                event.preventDefault();
                this.confirm();
                break;
            case "Escape":
                event.preventDefault();
                this.close();
                break;
        }
    }

}
