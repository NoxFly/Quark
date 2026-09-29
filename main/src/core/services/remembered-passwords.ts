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

import { Logger } from "@noxfly/noxus/main";
import { app } from "electron/main";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, normalize } from "node:path";
import { electronKeychain } from "src/core/services/system-keychain";
import type { SystemKeychain } from "src/core/services/system-keychain.types";

/** Format du fichier : chemin normalisé → mot de passe chiffré par le trousseau (base64). */
interface RememberedPasswordsFile {
    version: 1;
    entries: Record<string, string>;
}

const FILE_NAME = "remembered-passwords.json";

/**
 * Mots de passe de fichiers SQLite chiffrés, mémorisés à la demande de
 * l'utilisateur (« Mémoriser dans le trousseau »).
 *
 * Chaque mot de passe est chiffré par le trousseau du système avant d'être
 * écrit : le fichier ne contient jamais de secret en clair, et il est illisible
 * depuis un autre compte ou une autre machine. Sans trousseau disponible, le
 * service ne mémorise rien et ne restitue rien.
 */
export class RememberedPasswords {
    private entries: Record<string, string> | null = null;

    /**
     * @param keychain - Trousseau utilisé (factice dans les tests).
     * @param directory - Dossier du fichier ; lu à la première utilisation, car
     * `userData` n'est définitif qu'une fois l'environnement initialisé.
     */
    public constructor(
        private readonly keychain: SystemKeychain = electronKeychain,
        private readonly directory: () => string = () => app.getPath("userData"),
    ) {}

    /**
     * @description Indique si la mémorisation est possible sur ce système.
     * @returns `true` si le trousseau du système est utilisable.
     */
    public get available(): boolean {
        return this.keychain.isAvailable();
    }

    /**
     * @description Restitue le mot de passe mémorisé d'un fichier. Un secret que le
     * trousseau ne sait plus déchiffrer (profil système changé) est oublié.
     * @param filePath - Chemin du fichier chiffré.
     * @returns Le mot de passe, ou `null` s'il n'y en a pas (ou plus).
     */
    public get(filePath: string): string | null {
        if (!this.available) {
            return null;
        }

        const key = keyOf(filePath);
        const encrypted = this.load()[key];

        if (encrypted === undefined) {
            return null;
        }

        try {
            return this.keychain.decrypt(Buffer.from(encrypted, "base64"));
        }
        catch (error) {
            Logger.warn(`Remembered password is no longer readable, forgetting it: ${error instanceof Error ? error.message : String(error)}`);
            this.forget(filePath);
            return null;
        }
    }

    /**
     * @description Mémorise (ou remplace) le mot de passe d'un fichier.
     * @param filePath - Chemin du fichier chiffré.
     * @param password - Mot de passe à mémoriser.
     * @returns `false` si le trousseau est indisponible : rien n'a été écrit.
     */
    public remember(filePath: string, password: string): boolean {
        if (!this.available) {
            return false;
        }

        const entries = this.load();
        entries[keyOf(filePath)] = this.keychain.encrypt(password).toString("base64");
        this.save(entries);

        return true;
    }

    /**
     * @description Oublie le mot de passe d'un fichier (s'il y en a un).
     * @param filePath - Chemin du fichier chiffré.
     */
    public forget(filePath: string): void {
        const entries = this.load();
        const key = keyOf(filePath);

        if (!(key in entries)) {
            return;
        }

        delete entries[key];
        this.save(entries);
    }

    /**
     * @description Indique si un mot de passe est mémorisé pour ce fichier, sans le déchiffrer.
     * @param filePath - Chemin du fichier chiffré.
     * @returns `true` si une entrée existe.
     */
    public has(filePath: string): boolean {
        return keyOf(filePath) in this.load();
    }

    private get filePath(): string {
        return join(this.directory(), FILE_NAME);
    }

    private load(): Record<string, string> {
        if (this.entries) {
            return this.entries;
        }

        this.entries = {};

        try {
            if (existsSync(this.filePath)) {
                const parsed = JSON.parse(readFileSync(this.filePath, "utf-8")) as Partial<RememberedPasswordsFile>;

                if (parsed.entries && typeof parsed.entries === "object") {
                    this.entries = { ...parsed.entries };
                }
            }
        }
        catch (error) {
            Logger.warn(`Unable to read remembered passwords: ${error instanceof Error ? error.message : String(error)}`);
        }

        return this.entries;
    }

    private save(entries: Record<string, string>): void {
        this.entries = entries;

        const content: RememberedPasswordsFile = { version: 1, entries };

        try {
            // 0o600 : lisible par le seul compte, même si le contenu est déjà chiffré.
            writeFileSync(this.filePath, JSON.stringify(content, null, 2), { encoding: "utf-8", mode: 0o600 });
        }
        catch (error) {
            Logger.warn(`Unable to save remembered passwords: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

/**
 * Clé d'un fichier : chemin normalisé, insensible à la casse sous Windows, où
 * `C:\\Data\\a.db` et `c:/data/A.db` désignent le même fichier.
 */
function keyOf(filePath: string): string {
    const normalized = normalize(filePath);

    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
