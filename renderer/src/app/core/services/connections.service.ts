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
    ConnectionFolder,
    ConnectionProfile,
    ConnectionProfileInput,
    ConnectionTagDef,
    ConnectionTagInput,
    ConnectionTestResult,
    ConnectionVaultStatus,
} from "@shared/connection";
import type { R_TestConnectionBody } from "@shared/types";
import { DatabaseService } from "src/app/core/services/database.service";
import { NoxusService } from "src/app/core/services/noxus.service";
import { reorderProfiles } from "src/app/shared/helpers/connections.helper";

const COLLAPSED_FOLDERS_STORAGE_KEY = "quark.connections.collapsedFolders";

/**
 * Service de gestion du coffre de connexions sauvegardées.
 *
 * Expose l'état du coffre (initialisé / déverrouillé / protégé par mot de passe maître),
 * la liste des profils et des dossiers, et délègue les opérations au main via l'IPC.
 * La connexion effective à une base est déléguée à `DatabaseService` (état de la fenêtre).
 */
@Injectable({ providedIn: "root" })
export class ConnectionsService {
    private readonly noxus = inject(NoxusService);
    private readonly dbService = inject(DatabaseService);

    public readonly status = signal<ConnectionVaultStatus>({
        initialized: false,
        unlocked: false,
        masterPasswordEnabled: true,
    });

    public readonly profiles = signal<ConnectionProfile[]>([]);
    public readonly folders = signal<ConnectionFolder[]>([]);
    /** Étiquettes du coffre, dans leur ordre d'affichage. */
    public readonly tags = signal<ConnectionTagDef[]>([]);
    /** Dossiers repliés dans l'arbre du gestionnaire (persistés entre les sessions). */
    public readonly collapsedFolders = signal<ReadonlySet<string>>(this.readCollapsedFolders());

    /**
     * @description Rafraîchit l'état du coffre depuis le main.
     * @returns L'état courant.
     */
    public async refreshStatus(): Promise<ConnectionVaultStatus> {
        const status = await this.noxus.ipc.connVaultStatus();
        this.status.set(status);
        return status;
    }

    /**
     * @description Définit le mot de passe maître et initialise un coffre vide.
     * @param masterPassword Nouveau mot de passe maître.
     */
    public async initialize(masterPassword: string): Promise<void> {
        await this.noxus.ipc.connInitialize(masterPassword);
        await this.refreshStatus();
        await this.loadAll();
    }

    /**
     * @description Déverrouille le coffre.
     * @param masterPassword Mot de passe maître (vide quand le coffre n'en exige pas).
     * @returns `false` si le mot de passe est incorrect.
     */
    public async unlock(masterPassword: string): Promise<boolean> {
        const ok = await this.noxus.ipc.connUnlock(masterPassword);

        if (ok) {
            await this.refreshStatus();
            await this.loadAll();
        }

        return ok;
    }

    /**
     * @description Verrouille le coffre et vide les listes locales.
     */
    public async lock(): Promise<void> {
        await this.noxus.ipc.connLock();
        this.profiles.set([]);
        this.folders.set([]);
        this.tags.set([]);
        await this.refreshStatus();
    }

    /**
     * @description Active ou désactive la protection du coffre par mot de passe maître.
     * @param enabled `true` pour activer (mot de passe = nouveau), `false` pour désactiver
     * (mot de passe = actuel, pour confirmer).
     * @param masterPassword Mot de passe maître.
     */
    public async setMasterPassword(enabled: boolean, masterPassword: string): Promise<void> {
        await this.noxus.ipc.connSetMasterPassword({ enabled, masterPassword });
        await this.refreshStatus();
    }

    /**
     * @description Charge profils, dossiers et étiquettes (coffre déverrouillé requis).
     */
    public async loadAll(): Promise<void> {
        await Promise.all([this.loadProfiles(), this.loadFolders(), this.loadTags()]);
    }

    /**
     * @description Charge la liste des étiquettes (coffre déverrouillé requis).
     */
    public async loadTags(): Promise<void> {
        this.tags.set(await this.noxus.ipc.connTags());
    }

    /**
     * @description Crée une étiquette puis recharge la liste.
     * @param input Nom et couleur.
     * @returns L'étiquette créée.
     */
    public async createTag(input: ConnectionTagInput): Promise<ConnectionTagDef> {
        const tag = await this.noxus.ipc.connTagCreate(input);
        await this.loadTags();
        return tag;
    }

    /**
     * @description Renomme ou recolore une étiquette puis recharge la liste.
     * @param id Étiquette modifiée.
     * @param input Champs modifiés (un champ absent reste inchangé).
     */
    public async updateTag(id: string, input: ConnectionTagInput): Promise<void> {
        await this.noxus.ipc.connTagUpdate(id, input);
        await this.loadTags();
    }

    /**
     * @description Supprime une étiquette ; les profils qui la portaient sont rechargés sans elle.
     * @param id Étiquette supprimée.
     */
    public async deleteTag(id: string): Promise<void> {
        await this.noxus.ipc.connTagDelete(id);
        await Promise.all([this.loadTags(), this.loadProfiles()]);
    }

    /**
     * @description Déplace un profil dans un dossier, à la position donnée, puis recharge
     * la liste. La liste locale est réordonnée aussitôt pour que l'arbre ne revienne pas
     * brièvement à l'ancien ordre pendant l'aller-retour IPC.
     * @param id Profil déplacé.
     * @param folderId Dossier d'arrivée.
     * @param index Position parmi les autres profils de ce dossier.
     */
    public async moveProfile(id: string, folderId: string, index: number): Promise<void> {
        this.profiles.update(profiles => reorderProfiles(profiles, id, folderId, index));
        await this.noxus.ipc.connMove(id, folderId, index);
        await this.loadProfiles();
    }

    /**
     * @description Charge la liste des profils (coffre déverrouillé requis).
     */
    public async loadProfiles(): Promise<void> {
        const profiles = await this.noxus.ipc.connList();
        this.profiles.set(profiles);
    }

    /**
     * @description Charge la liste des dossiers (coffre déverrouillé requis).
     */
    public async loadFolders(): Promise<void> {
        const folders = await this.noxus.ipc.connFolders();
        this.folders.set(folders);
    }

    /**
     * @description Crée un profil puis recharge la liste.
     * @param input Données du profil.
     * @returns Le profil créé.
     */
    public async create(input: ConnectionProfileInput): Promise<ConnectionProfile> {
        const created = await this.noxus.ipc.connCreate(input);
        await this.loadProfiles();
        return created;
    }

    /**
     * @description Met à jour un profil puis recharge la liste.
     * @param id Identifiant du profil.
     * @param input Données du profil (mot de passe absent = inchangé).
     * @returns Le profil mis à jour.
     */
    public async update(id: string, input: ConnectionProfileInput): Promise<ConnectionProfile> {
        const updated = await this.noxus.ipc.connUpdate(id, input);
        await this.loadProfiles();
        return updated;
    }

    /**
     * @description Supprime un profil (et son secret) puis recharge la liste.
     * @param id Identifiant du profil.
     */
    public async remove(id: string): Promise<void> {
        await this.noxus.ipc.connDelete(id);
        await this.loadProfiles();
    }

    /**
     * @description Crée un dossier puis recharge la liste des dossiers.
     * @param name Nom du dossier.
     * @returns Le dossier créé.
     */
    public async createFolder(name: string): Promise<ConnectionFolder> {
        const folder = await this.noxus.ipc.connFolderCreate({ name });
        await this.loadFolders();
        return folder;
    }

    /**
     * @description Renomme un dossier puis recharge la liste des dossiers.
     * @param id Identifiant du dossier.
     * @param name Nouveau nom.
     */
    public async renameFolder(id: string, name: string): Promise<void> {
        await this.noxus.ipc.connFolderUpdate(id, { name });
        await this.loadFolders();
    }

    /**
     * @description Supprime un dossier ; ses profils rejoignent le premier dossier restant.
     * Les profils sont rechargés aussi, le main pouvant réaffecter leur `folderId`.
     * @param id Identifiant du dossier.
     */
    public async deleteFolder(id: string): Promise<void> {
        await this.noxus.ipc.connFolderDelete(id);
        await this.loadAll();
    }

    /**
     * @description Replie ou déplie un dossier de l'arbre et persiste l'état.
     * @param id Identifiant du dossier.
     */
    public toggleFolder(id: string): void {
        const next = new Set(this.collapsedFolders());

        if (next.has(id)) {
            next.delete(id);
        }
        else {
            next.add(id);
        }

        this.collapsedFolders.set(next);
        this.writeCollapsedFolders(next);
    }

    /**
     * @description Déplie un dossier (après l'enregistrement d'un profil qu'il contient).
     * @param id Identifiant du dossier.
     */
    public expandFolder(id: string): void {
        if (this.collapsedFolders().has(id)) {
            this.toggleFolder(id);
        }
    }

    /**
     * @description Teste une connexion sans l'ouvrir dans la fenêtre.
     * @param body Cible du test.
     * @returns Le résultat (latence ou erreur du driver).
     */
    public async testConnection(body: R_TestConnectionBody): Promise<ConnectionTestResult> {
        return this.noxus.ipc.testConnection(body);
    }

    /**
     * @description Connecte la fenêtre à la base d'un profil sauvegardé.
     * @param profile Profil à ouvrir.
     */
    public async connect(profile: ConnectionProfile): Promise<void> {
        await this.dbService.connectFromProfile(profile);
    }

    /**
     * @description Importe des profils depuis un fichier XML chiffré et recharge les listes.
     * @param passphrase Passphrase du fichier.
     * @returns Le nombre de profils importés.
     */
    public async importProfiles(passphrase: string): Promise<number> {
        const count = await this.noxus.ipc.connImport(passphrase);

        if (count > 0) {
            await this.loadAll();
        }

        return count;
    }

    private readCollapsedFolders(): ReadonlySet<string> {
        try {
            const raw = localStorage.getItem(COLLAPSED_FOLDERS_STORAGE_KEY);
            const parsed: unknown = raw ? JSON.parse(raw) : [];
            return new Set(Array.isArray(parsed) ? parsed.filter(id => typeof id === "string") : []);
        }
        catch {
            // localStorage indisponible ou valeur corrompue : tout est déplié.
            return new Set();
        }
    }

    private writeCollapsedFolders(ids: ReadonlySet<string>): void {
        try {
            localStorage.setItem(COLLAPSED_FOLDERS_STORAGE_KEY, JSON.stringify([...ids]));
        }
        catch {
            // Persistance best-effort : l'état reste valable pour la session.
        }
    }
}
