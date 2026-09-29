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

import { inject, Injectable, NotFoundException } from "@noxfly/noxus/main";
import type { ConnectionConnectResult } from "@shared/connection";
import { BrowserWindow, dialog } from "electron/main";
import { readFile, writeFile } from "node:fs/promises";
import { ConnectionStore } from "src/core/services/connection-store";
import { Application } from "src/modules/application";
import { DbService } from "src/modules/db/db.service";

const PROFILE_FILE_FILTER = { name: "Encrypted connection profile", extensions: ["xml"] };

/**
 * Coffre de connexions de l'application, partagé par toutes les fenêtres :
 * il est déverrouillé une fois par session.
 */
@Injectable({ lifetime: "singleton" })
export class ConnectionsService {
    public readonly store = new ConnectionStore();

    private readonly application = inject(Application);
    private readonly dbService = inject(DbService);

    /**
     * Ouvre dans la fenêtre appelante la base décrite par un profil.
     */
    public async connect(senderId: number, id: string): Promise<ConnectionConnectResult> {
        const window = this.application.requireWindow(senderId);
        const profile = this.store.getProfile(id);

        if (!profile) {
            throw new NotFoundException(`Connection profile not found: ${id}`);
        }

        if (profile.connectionType === "network") {
            await this.dbService.openNetworkConnection(window, {
                driverType: profile.driverType,
                host: profile.host ?? "localhost",
                port: profile.port ?? 0,
                username: profile.username ?? "",
                password: profile.password ?? "",
                database: profile.database ?? "",
                authMode: profile.authMode,
                clientId: profile.clientId,
                tenantId: profile.tenantId,
            });

            // Le schéma réseau est chargé en arrière-plan par le renderer.
            return { needsPassword: false, database: null };
        }

        // Connexion fichier : le driver est réinitialisé avant l'ouverture, pour
        // qu'un driver réseau actif ne lise pas le chemin comme une URI.
        const filePath = profile.filePath ?? "";
        await window.setDriverType(profile.driverType);
        const needsPassword = await window.openDatabase(filePath);

        // Fichier chiffré sans mot de passe stocké : le renderer affiche sa
        // demande habituelle et rouvrira le fichier avec le mot de passe saisi.
        if (needsPassword && !profile.password) {
            await window.closeDatabase();
            return { needsPassword: true, database: null };
        }

        if (needsPassword && profile.password) {
            await window.unlockDatabase(profile.password);
        }

        this.application.rememberRecentFile(filePath, needsPassword);

        return { needsPassword: false, database: await window.getDatabaseSchema() };
    }

    /**
     * Exporte des profils dans un fichier chiffré choisi par l'utilisateur.
     * @returns `false` si l'utilisateur a annulé.
     */
    public async exportProfiles(senderId: number, ids: string[], passphrase: string): Promise<boolean> {
        const result = await dialog.showSaveDialog(this.parentWindow(senderId), {
            title: "Export connections",
            defaultPath: "connections.xml",
            filters: [PROFILE_FILE_FILTER],
        });

        if (result.canceled || !result.filePath) {
            return false;
        }

        await writeFile(result.filePath, await this.store.exportProfiles(ids, passphrase), "utf-8");

        return true;
    }

    /**
     * Importe les profils d'un fichier chiffré choisi par l'utilisateur.
     * @returns Le nombre de profils importés (0 si l'utilisateur a annulé).
     */
    public async importProfiles(senderId: number, passphrase: string): Promise<number> {
        const result = await dialog.showOpenDialog(this.parentWindow(senderId), {
            title: "Import connections",
            properties: ["openFile"],
            filters: [PROFILE_FILE_FILTER],
        });

        const [filePath] = result.filePaths;

        if (result.canceled || !filePath) {
            return 0;
        }

        return await this.store.importProfiles(await readFile(filePath, "utf-8"), passphrase);
    }

    private parentWindow(senderId: number): BrowserWindow {
        return this.application.getWindowBySenderId(senderId)?.browserWindow ?? BrowserWindow.getFocusedWindow()!;
    }
}
