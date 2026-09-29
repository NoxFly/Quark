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
import type { RecentDatabaseEntry } from "@shared/ipc-renderer";
import { ConnectionsService } from "src/app/core/services/connections.service";
import { DatabaseService } from "src/app/core/services/database.service";
import { NoxusService } from "src/app/core/services/noxus.service";
import { SettingsService } from "src/app/core/services/settings.service";
import { StateService } from "src/app/core/services/state.service";
import { RecentDatabaseItemComponent } from "src/app/shared/components/recent-databases/recent-database-item/recent-database-item.component";
import { TranslatePipe } from "src/app/shared/pipes/translate.pipe";

/** Au-delà, la colonne défilerait : la liste complète reste accessible par Ctrl+R. */
const MAX_RECENTS = 8;

/**
 * Colonne gauche de la page d'accueil : identité de l'application, bases
 * ouvertes récemment, accès au gestionnaire de connexions et liens d'aide.
 *
 * Les liens du bas émettent les mêmes événements de document que la titlebar
 * (`open-shortcuts`, `open-settings`, `open-about-dialog`, `open-connections-manager`),
 * écoutés par `AppComponent`.
 */
@Component({
    selector: "app-home-sidebar",
    standalone: true,
    templateUrl: "./home-sidebar.component.html",
    styleUrl: "./home-sidebar.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [TranslatePipe, RecentDatabaseItemComponent],
})
export class HomeSidebarComponent implements OnInit {
    private readonly noxus = inject(NoxusService);
    private readonly dbService = inject(DatabaseService);
    private readonly settings = inject(SettingsService);
    private readonly connections = inject(ConnectionsService);
    protected readonly state = inject(StateService);

    protected readonly recents = signal<RecentDatabaseEntry[]>([]);

    /** Nombre de profils, `null` tant que le coffre est verrouillé (le compte est inconnu). */
    protected readonly profileCount = computed<number | null>(() => {
        return this.connections.status().unlocked ? this.connections.profiles().length : null;
    });

    public async ngOnInit(): Promise<void> {
        await Promise.all([this.loadRecents(), this.loadVault()]);
    }

    /**
     * Rouvre une base récente.
     */
    protected async openRecent(entry: RecentDatabaseEntry): Promise<void> {
        await this.dbService.openRecentDatabase(entry, this.settings.settings().connectionTimeout);
    }

    /**
     * Déclenche une action partagée avec la titlebar (événement de document).
     */
    protected emit(eventName: string, event: Event): void {
        event.preventDefault();
        document.dispatchEvent(new CustomEvent(eventName));
    }

    private async loadRecents(): Promise<void> {
        try {
            const entries = await this.noxus.ipc.getRecentDatabases();
            this.recents.set(entries.slice(0, MAX_RECENTS));
        }
        catch {
            // Historique illisible : la section reste vide, l'accueil reste utilisable.
            this.recents.set([]);
        }
    }

    private async loadVault(): Promise<void> {
        try {
            const status = await this.connections.refreshStatus();

            if (status.unlocked) {
                await this.connections.loadProfiles();
            }
        }
        catch {
            // Coffre indisponible : le compteur affiche le cadenas.
        }
    }
}
