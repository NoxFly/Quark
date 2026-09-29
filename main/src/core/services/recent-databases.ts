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

import { app } from "electron/main";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseDriverType } from "@shared/driver";
import type { RecentDatabaseEntry } from "@shared/ipc-renderer";

const MAX_RECENT = 20;

/**
 * Gère la persistance de l'historique des bases de données récemment ouvertes.
 * Stocke dans un fichier JSON dans le dossier userData d'Electron.
 * Supporte les connexions fichier (SQLite, chiffrées ou non), réseau et les
 * bases SQLite distantes (libSQL / Turso). Aucun secret n'y est jamais écrit.
 */
export class RecentDatabases {
    private readonly filePath: string;
    private entries: RecentDatabaseEntry[] = [];

    public constructor() {
        this.filePath = join(app.getPath("userData"), "recent-databases.json");
        this.load();
    }

    /**
     * Retourne la liste des bases récentes (max 20), triées par dernière ouverture.
     */
    public getAll(): RecentDatabaseEntry[] {
        return this.entries;
    }

    /**
     * Ajoute ou met à jour une connexion fichier dans l'historique.
     * @param dbFilePath - Chemin absolu vers le fichier de base de données.
     * @param encrypted - Indique si la base est chiffrée et nécessite un mot de passe.
     */
    public addFile(dbFilePath: string, encrypted: boolean): void {
        const parts = dbFilePath.replace(/\\/g, "/").split("/");
        const displayName = parts[parts.length - 1] ?? dbFilePath;
        const displaySubtitle = parts.slice(0, -1).join("/");

        this.upsert({
            connectionType: "file",
            driverType: "sqlite",
            displayName,
            displaySubtitle,
            lastOpened: Date.now(),
            requiresPassword: encrypted,
            filePath: dbFilePath,
        });
    }

    /**
     * Ajoute ou met à jour une connexion réseau dans l'historique.
     * Le mot de passe n'est jamais stocké.
     * @param params - Paramètres de connexion réseau (sans mot de passe).
     */
    public addNetwork(params: {
        driverType: DatabaseDriverType;
        host: string;
        port: number;
        username: string;
        database: string;
        hasEmptyPassword?: boolean;
    }): void {
        const requiresPassword = !params.hasEmptyPassword;
        this.upsert({
            connectionType: "network",
            driverType: params.driverType,
            displayName: params.database,
            displaySubtitle: `${params.username}@${params.host}:${params.port}`,
            lastOpened: Date.now(),
            requiresPassword,
            host: params.host,
            port: params.port,
            username: params.username,
            database: params.database,
        });
    }

    /**
     * Ajoute ou met à jour une base SQLite distante dans l'historique.
     * Le jeton d'authentification n'est jamais stocké.
     * @param url - URL de la base (`libsql://`, `https://`…).
     * @param hasToken - Un jeton a été fourni : il faudra le redemander.
     */
    public addRemote(url: string, hasToken: boolean): void {
        let displayName = url;

        try {
            displayName = new URL(url).hostname || url;
        }
        catch {
            // URL déjà validée à l'ouverture : on garde le texte brut par prudence.
        }

        this.upsert({
            connectionType: "remote",
            driverType: "libsql",
            displayName,
            displaySubtitle: url,
            lastOpened: Date.now(),
            requiresPassword: hasToken,
            url,
        });
    }

    /**
     * Insère ou met à jour une entrée en tête de liste, dans la limite de MAX_RECENT.
     */
    private upsert(entry: RecentDatabaseEntry): void {
        // Dédupliquer : même fichier ou même connexion réseau
        this.entries = this.entries.filter(e => !this.isSameEntry(e, entry));

        this.entries.unshift(entry);

        if (this.entries.length > MAX_RECENT) {
            this.entries = this.entries.slice(0, MAX_RECENT);
        }

        this.save();
    }

    /**
     * Détermine si deux entrées représentent la même connexion.
     */
    private isSameEntry(a: RecentDatabaseEntry, b: RecentDatabaseEntry): boolean {
        if (a.connectionType !== b.connectionType) {
            return false;
        }

        if (a.connectionType === "file") {
            return a.filePath === b.filePath;
        }

        if (a.connectionType === "remote") {
            return a.url === b.url;
        }

        return (
            a.driverType === b.driverType
            && a.host === b.host
            && a.port === b.port
            && a.database === b.database
            && a.username === b.username
        );
    }

    /**
     * Charge l'historique depuis le disque.
     */
    private load(): void {
        try {
            if (existsSync(this.filePath)) {
                const raw = readFileSync(this.filePath, "utf-8");
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    this.entries = parsed.slice(0, MAX_RECENT);
                }
            }
        }
        catch {
            this.entries = [];
        }
    }

    /**
     * Sauvegarde l'historique sur le disque.
     */
    private save(): void {
        try {
            writeFileSync(this.filePath, JSON.stringify(this.entries, null, 2), "utf-8");
        }
        catch {
            // Échec silencieux si le dossier n'est pas accessible
        }
    }
}
