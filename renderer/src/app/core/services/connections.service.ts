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

import { inject, Injectable, signal } from "@angular/core";
import type {
    ConnectionProfile,
    ConnectionProfileInput,
    ConnectionVaultStatus,
} from "@shared/connection";
import { DatabaseService } from "src/app/core/services/database.service";
import { NoxusService } from "src/app/core/services/noxus.service";

/**
 * Service de gestion du coffre de connexions sauvegardées.
 *
 * Expose l'état du coffre (initialisé / déverrouillé) et la liste des profils,
 * et délègue les opérations au main via l'IPC. La connexion effective à une base
 * est déléguée à `DatabaseService` (état de la fenêtre).
 */
@Injectable({ providedIn: "root" })
export class ConnectionsService {
    private readonly noxus = inject(NoxusService);
    private readonly dbService = inject(DatabaseService);

    public readonly status = signal<ConnectionVaultStatus>({ initialized: false, unlocked: false });
    public readonly profiles = signal<ConnectionProfile[]>([]);

    /**
     * Rafraîchit l'état du coffre depuis le main.
     */
    public async refreshStatus(): Promise<ConnectionVaultStatus> {
        const status = await this.noxus.ipc.connVaultStatus();
        this.status.set(status);
        return status;
    }

    /**
     * Définit le mot de passe maître et initialise un coffre vide.
     */
    public async initialize(masterPassword: string): Promise<void> {
        await this.noxus.ipc.connInitialize(masterPassword);
        await this.refreshStatus();
        await this.loadProfiles();
    }

    /**
     * Déverrouille le coffre. Retourne `false` si le mot de passe est incorrect.
     */
    public async unlock(masterPassword: string): Promise<boolean> {
        const ok = await this.noxus.ipc.connUnlock(masterPassword);
        if (ok) {
            await this.refreshStatus();
            await this.loadProfiles();
        }
        return ok;
    }

    /**
     * Verrouille le coffre et vide la liste locale.
     */
    public async lock(): Promise<void> {
        await this.noxus.ipc.connLock();
        this.profiles.set([]);
        await this.refreshStatus();
    }

    /**
     * Charge la liste des profils (coffre déverrouillé requis).
     */
    public async loadProfiles(): Promise<void> {
        const profiles = await this.noxus.ipc.connList();
        this.profiles.set(profiles);
    }

    /**
     * Crée un profil puis recharge la liste.
     */
    public async create(input: ConnectionProfileInput): Promise<void> {
        await this.noxus.ipc.connCreate(input);
        await this.loadProfiles();
    }

    /**
     * Met à jour un profil puis recharge la liste.
     */
    public async update(id: string, input: ConnectionProfileInput): Promise<void> {
        await this.noxus.ipc.connUpdate(id, input);
        await this.loadProfiles();
    }

    /**
     * Supprime un profil puis recharge la liste.
     */
    public async remove(id: string): Promise<void> {
        await this.noxus.ipc.connDelete(id);
        await this.loadProfiles();
    }

    /**
     * Connecte la fenêtre à la base d'un profil sauvegardé.
     */
    public async connect(profile: ConnectionProfile): Promise<void> {
        await this.dbService.connectFromProfile(profile);
    }

    /**
     * Exporte des profils vers un fichier XML chiffré par une passphrase.
     * @returns `true` si l'export a été écrit, `false` si l'utilisateur a annulé.
     */
    public async exportProfiles(ids: string[], passphrase: string): Promise<boolean> {
        return this.noxus.ipc.connExport(ids, passphrase);
    }

    /**
     * Importe des profils depuis un fichier XML chiffré et recharge la liste.
     * @returns Le nombre de profils importés.
     */
    public async importProfiles(passphrase: string): Promise<number> {
        const count = await this.noxus.ipc.connImport(passphrase);
        if (count > 0) {
            await this.loadProfiles();
        }
        return count;
    }
}
