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

import { effect, inject, Injectable, signal, untracked } from "@angular/core";
import type { SqlHistoryEntry } from "src/app/core/models/sql-history.model";
import { NoxusService } from "src/app/core/services/noxus.service";
import { StateService } from "src/app/core/services/state.service";
import { isEncryptedFile } from "src/app/shared/helpers/database-encryption.helper";
import { historyStorageKey, parseStoredHistory, pushHistoryEntry } from "src/app/shared/helpers/sql-history.helper";

/**
 * Historique des requêtes de l'éditeur SQL, propre à chaque base.
 *
 * Il est persisté dans le `localStorage` (50 entrées par base), sauf pour une
 * base chiffrée : une requête transporte souvent des valeurs réelles
 * (`INSERT … VALUES`, `WHERE email = …`), et l'écrire en clair sur le disque
 * contournerait le chiffrement du fichier. L'historique d'une base chiffrée
 * reste donc en mémoire, pour la durée de la session.
 */
@Injectable({ providedIn: "root" })
export class SqlHistoryService {
    private readonly state = inject(StateService);
    private readonly noxus = inject(NoxusService);

    private readonly _entries = signal<SqlHistoryEntry[]>([]);

    /** Requêtes exécutées sur la base courante, de la plus récente à la plus ancienne. */
    public readonly entries = this._entries.asReadonly();

    /** Base dont l'historique est chargé. */
    private source: string | null = null;

    /**
     * L'historique de la base courante peut être écrit sur le disque. Faux tant
     * que l'on ignore si la base est chiffrée.
     */
    private persistable = false;

    public constructor() {
        effect(() => {
            const source = this.state.filePath();
            untracked(() => this.switchSource(source));
        });
    }

    /**
     * @description Ajoute une requête exécutée en tête de l'historique de la base courante.
     * @param entry - Requête et résultat de son exécution.
     */
    public add(entry: SqlHistoryEntry): void {
        this._entries.update(history => pushHistoryEntry(history, entry));
        this.persist();
    }

    /**
     * @description Vide l'historique de la base courante.
     */
    public clear(): void {
        this._entries.set([]);
        this.persist();
    }

    /**
     * Charge l'historique d'une autre base.
     */
    private switchSource(source: string | null): void {
        if (source === this.source) {
            return;
        }

        this.source = source;
        this.persistable = false;
        this._entries.set([]);

        if (source === null) {
            return;
        }

        void this.resolvePersistence(source);
    }

    /**
     * Détermine si la base est chiffrée — l'information vient de la liste des
     * bases récentes, seule trace qu'en garde le renderer — puis relit
     * l'historique stocké si la base ne l'est pas.
     */
    private async resolvePersistence(source: string): Promise<void> {
        let encrypted = false;

        try {
            const recents = await this.noxus.ipc.getRecentDatabases();
            // Une source absente des récents (connexion réseau) n'est pas un fichier chiffré.
            encrypted = isEncryptedFile(recents, source) === true;
        }
        catch {
            // Sans la liste, on ne peut rien affirmer : l'historique reste en mémoire.
            encrypted = true;
        }

        // La base a pu changer pendant la lecture de la liste.
        if (this.source !== source) {
            return;
        }

        this.persistable = !encrypted;

        if (!this.persistable) {
            this.removeStored(source);
            return;
        }

        const stored = parseStoredHistory(this.readStored(source));
        // Les requêtes exécutées pendant la résolution passent devant l'historique stocké.
        const merged = this._entries().reduceRight((history, entry) => pushHistoryEntry(history, entry), stored);

        this._entries.set(merged);
        this.persist();
    }

    /**
     * Écrit l'historique courant, si la base le permet.
     */
    private persist(): void {
        if (!this.persistable || this.source === null) {
            return;
        }

        try {
            localStorage.setItem(historyStorageKey(this.source), JSON.stringify(this._entries()));
        }
        catch {
            // Quota dépassé ou stockage indisponible : l'historique vaut pour la session.
        }
    }

    /**
     * Lit l'historique stocké d'une base.
     */
    private readStored(source: string): string | null {
        try {
            return localStorage.getItem(historyStorageKey(source));
        }
        catch {
            return null;
        }
    }

    /**
     * Supprime un historique stocké avant que la base ne soit chiffrée.
     */
    private removeStored(source: string): void {
        try {
            localStorage.removeItem(historyStorageKey(source));
        }
        catch {
            // Stockage indisponible : il n'y a rien à supprimer.
        }
    }
}
