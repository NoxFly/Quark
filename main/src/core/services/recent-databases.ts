/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import { app } from "electron/main";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseDriverType } from "@shared/driver";

/** Entrée dans l'historique des bases récentes. */
export interface RecentDatabaseEntry {
    connectionType: "file" | "network";
    driverType: DatabaseDriverType;
    displayName: string;
    displaySubtitle: string;
    lastOpened: number;
    requiresPassword: boolean;
    // Connexion fichier
    filePath?: string;
    // Connexion réseau (aucun mot de passe stocké)
    host?: string;
    port?: number;
    username?: string;
    database?: string;
}

const MAX_RECENT = 20;

/**
 * Gère la persistance de l'historique des bases de données récemment ouvertes.
 * Stocke dans un fichier JSON dans le dossier userData d'Electron.
 * Supporte les connexions fichier (SQLite, chiffrées ou non) et réseau.
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
