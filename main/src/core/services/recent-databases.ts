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
     *
     * `port`/`username` sont optionnels pour une connexion établie par chaîne de
     * connexion (MongoDB) plutôt que par champs séparés : `host` porte alors la
     * liste d'hôtes de l'URI (« host1:27017,host2:27017 »), déjà complète, sans port
     * à concaténer par-dessus — la propager dans `port` doublonnerait le port dans
     * le sous-titre affiché (« host:27017:0 »). `uri` est conservé pour permettre une
     * reconnexion fidèle depuis l'historique (sans lui, `host`/`port` vides feraient
     * échouer la reconnexion).
     * @param params - Paramètres de connexion réseau (sans mot de passe).
     */
    public addNetwork(params: {
        driverType: DatabaseDriverType;
        host: string;
        port?: number;
        username?: string;
        database: string;
        uri?: string;
        hasEmptyPassword?: boolean;
    }): void {
        const requiresPassword = !params.hasEmptyPassword;
        const displaySubtitle = params.port
            ? (params.username ? `${params.username}@${params.host}:${params.port}` : `${params.host}:${params.port}`)
            : params.host;

        this.upsert({
            connectionType: "network",
            driverType: params.driverType,
            displayName: params.database,
            displaySubtitle,
            lastOpened: Date.now(),
            requiresPassword,
            host: params.host,
            port: params.port,
            username: params.username,
            database: params.database,
            uri: params.uri,
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
     * Ajoute ou met à jour un fichier de partage dans l'historique. Seuls son nom
     * et son chemin sont conservés : rien de la base à laquelle il donne accès.
     * @param filePath - Chemin du fichier `.quarkshare`.
     * @param name - Nom donné au partage par son auteur.
     * @param driverType - Driver de la base partagée (logo de l'entrée).
     */
    public addShare(filePath: string, name: string, driverType: DatabaseDriverType): void {
        const parts = filePath.replace(/\\/g, "/").split("/");

        this.upsert({
            connectionType: "share",
            driverType,
            displayName: name,
            displaySubtitle: parts.slice(0, -1).join("/"),
            lastOpened: Date.now(),
            requiresPassword: true,
            filePath,
        });
    }

    /**
     * Retire une entrée de l'historique (menu contextuel « Supprimer »).
     * Même critère de correspondance que `upsert` : chemin de fichier, URL distante,
     * ou triplet hôte/port/base/utilisateur pour une connexion réseau.
     */
    public remove(entry: RecentDatabaseEntry): void {
        const before = this.entries.length;
        this.entries = this.entries.filter(e => !this.isSameEntry(e, entry));

        if (this.entries.length !== before) {
            this.save();
        }
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

        if (a.connectionType === "file" || a.connectionType === "share") {
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
                    const sliced: RecentDatabaseEntry[] = parsed.slice(0, MAX_RECENT);
                    this.entries = sliced.filter(e => !this.isUnusable(e));

                    if (this.entries.length !== sliced.length) {
                        this.save();
                    }
                }
            }
        }
        catch {
            this.entries = [];
        }
    }

    /**
     * Une entrée réseau sans hôte ni chaîne de connexion (« @:0 ») vient d'avant le
     * correctif MongoDB : ni affichable ni réouvrable, elle est purgée au chargement
     * plutôt que de rester coincée dans l'historique jusqu'à une reconnexion manuelle.
     */
    private isUnusable(entry: RecentDatabaseEntry): boolean {
        return entry.connectionType === "network" && !entry.host && !entry.uri;
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
