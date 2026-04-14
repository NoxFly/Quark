/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import { app } from "electron/main";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Entrée dans l'historique des bases récentes. */
export interface RecentDatabaseEntry {
    filePath: string;
    fileName: string;
    directory: string;
    lastOpened: number;
}

const MAX_RECENT = 20;

/**
 * Gère la persistance de l'historique des bases de données récemment ouvertes.
 * Stocke dans un fichier JSON dans le dossier userData d'Electron.
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
     * Ajoute ou met à jour une entrée dans l'historique.
     */
    public add(dbFilePath: string): void {
        const parts = dbFilePath.replace(/\\/g, "/").split("/");
        const fileName = parts.pop() ?? dbFilePath;
        const directory = parts.join("/");

        // Supprimer l'entrée existante si présente
        this.entries = this.entries.filter(e => e.filePath !== dbFilePath);

        // Ajouter en tête
        this.entries.unshift({
            filePath: dbFilePath,
            fileName,
            directory,
            lastOpened: Date.now(),
        });

        // Garder seulement les N dernières
        if (this.entries.length > MAX_RECENT) {
            this.entries = this.entries.slice(0, MAX_RECENT);
        }

        this.save();
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
