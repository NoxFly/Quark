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

import { type IApp, inject, Injectable, NotFoundException, WindowManager } from "@noxfly/noxus/main";
import { app, BrowserWindow, dialog, Menu } from "electron/main";
import { normalize } from "node:path";
import type { LoadAppResult, RecentDatabaseEntry } from "@shared/ipc-renderer";
import { environment } from "src/core/environment";
import { RecentDatabases } from "src/core/services/recent-databases";
import { SettingsStore } from "src/core/services/settings-store";
import { Window } from "src/core/services/window";
import { UpdaterService } from "src/modules/updater/updater.service";

@Injectable({ lifetime: "singleton" })
export class Application implements IApp {
    protected readonly windows = new Map<number, Window>();
    private readonly wm = inject(WindowManager);
    private readonly recentDatabases = new RecentDatabases();
    private readonly updater = inject(UpdaterService);
    private readonly settings = inject(SettingsStore);

    /**
     * Base passée en ligne de commande au lancement, avant qu'aucune fenêtre
     * n'existe. Elle est transférée à la première fenêtre créée, qui la remet à
     * son renderer via `load-app` une fois le pont IPC prêt : pousser l'événement
     * `open-file` sur un minuteur arbitraire la perdait silencieusement sur les
     * machines lentes à démarrer.
     */
    private pendingFile: string | null = null;

    /**
     *
     */
    public getFocusedWindow(): Window | null {
        const focusedWindow = BrowserWindow.getFocusedWindow();
        return this.windows.get(focusedWindow?.id!) || null;
    }

    /**
     *
     */
    public getWindowById(windowId: number): Window | null {
        return this.windows.get(windowId) || null;
    }

    /**
     * Trouve la fenêtre par le senderId (webContents.id) de Noxus.
     */
    public getWindowBySenderId(senderId: number): Window | null {
        for (const window of this.windows.values()) {
            if (window.senderId === senderId) {
                return window;
            }
        }
        return null;
    }

    /**
     * Retourne la fenêtre à l'origine d'une requête Noxus.
     * @throws NotFoundException si la fenêtre n'est pas (ou plus) enregistrée.
     */
    public requireWindow(senderId: number): Window {
        const window = this.getWindowBySenderId(senderId);

        if (!window) {
            throw new NotFoundException("Window not found");
        }

        return window;
    }

    /**
     * Vérifie si un fichier est déjà ouvert dans une des fenêtres.
     */
    public findWindowByFilePath(filePath: string): Window | null {
        const normalizedPath = normalize(filePath).toLowerCase();

        for (const window of this.windows.values()) {
            const dbPath = window.database.path;
            if (dbPath && normalize(dbPath).toLowerCase() === normalizedPath) {
                return window;
            }
        }

        return null;
    }

    /**
     * Ouvre un dialogue de sélection de fichier.
     */
    public async openFileDialog(parentWin?: BrowserWindow | null): Promise<string | null> {
        const result = await dialog.showOpenDialog(parentWin ?? BrowserWindow.getFocusedWindow()!, {
            properties: ["openFile"],
            filters: [
                { name: "SQLite Database", extensions: ["db", "sqlite", "sqlite3", "s3db"] },
                { name: "All Files", extensions: ["*"] },
            ],
        });

        if (result.canceled || result.filePaths.length === 0) {
            return null;
        }

        return result.filePaths[0];
    }

    /**
     * Met un fichier en attente pour la première fenêtre créée. Utilisé au
     * lancement, avant qu'aucune fenêtre n'existe.
     * @param filePath - Chemin absolu de la base à ouvrir.
     */
    public setPendingFile(filePath: string): void {
        this.pendingFile = filePath;
    }

    /**
     * Crée une fenêtre, l'enregistre et lui attache éventuellement une base à ouvrir.
     *
     * L'enregistrement se fait avant le chargement du document : le renderer
     * émet ses premières requêtes IPC pendant celui-ci, et une fenêtre non encore
     * enregistrée y serait introuvable par `senderId`.
     *
     * @param pendingFile - Base à ouvrir dès que le renderer est prêt.
     */
    public async openNewWindow(pendingFile: string | null = null): Promise<Window> {
        const window = await Window.create(
            this.wm,
            created => {
                this.windows.set(created.id, created);
                created.setPendingFile(pendingFile);
            },
            closed => this.onWindowClosed(closed),
        );

        window.focus();

        return window;
    }

    /**
     * Ramène l'application au premier plan.
     *
     * Une relance sans argument pendant qu'une instance tourne signifie que
     * l'utilisateur cherche sa fenêtre : la laisser sans effet donnait
     * l'impression que l'application ne répondait pas.
     */
    public focusExistingWindow(): void {
        const [target] = this.windows.values();

        if (target) {
            target.focus();
            return;
        }

        // Toutes les fenêtres ont été fermées sans que l'application se termine (macOS).
        void this.openNewWindow();
    }

    /**
     * Ouvre une base demandée depuis l'extérieur (seconde instance, événement
     * `open-file` de macOS).
     *
     * @param filePath - Chemin absolu de la base à ouvrir.
     */
    public openExternalFile(filePath: string): void {
        // Déjà ouverte ailleurs : on remonte cette fenêtre plutôt que d'ouvrir la
        // même base deux fois dans deux vues qui s'ignorent.
        const existing = this.findWindowByFilePath(filePath);

        if (existing) {
            existing.focus();
            return;
        }

        const [target] = this.windows.values();

        if (!target) {
            void this.openNewWindow(filePath);
            return;
        }

        target.focus();
        target.sendToRenderer("open-file", filePath);
    }

    /**
     *
     */
    public async onReady(): Promise<void> {
        // Menu contextuel de la barre des tâches (clic droit sur l'icône)
        const dockMenu = Menu.buildFromTemplate([
            {
                label: "New Window",
                click: () => {
                    void this.openNewWindow();
                },
            },
        ]);

        if (process.platform === "darwin") {
            app.dock?.setMenu(dockMenu);
        }
        else {
            // Sur Windows/Linux, on utilise le menu de la barre des tâches via jumplist.
            // La version portable doit relancer son exécutable d'origine : le
            // `process.execPath` extrait en dossier temporaire n'existe plus après fermeture.
            const executable = environment.portableExecutable ?? process.execPath;

            app.setUserTasks([
                {
                    program: executable,
                    arguments: "--new-window",
                    iconPath: executable,
                    iconIndex: 0,
                    title: "New Window",
                    description: "Open a new window",
                },
            ]);
        }

        // Après un redémarrage de mise à jour, chaque base qui était ouverte
        // retrouve sa fenêtre ; un fichier passé en argument reste prioritaire.
        const restore = this.settings.get("pendingRestore");

        if (restore.length > 0) {
            this.settings.set("pendingRestore", []);
        }

        const initialFiles = this.pendingFile ? [this.pendingFile] : restore;
        this.pendingFile = null;

        await this.openNewWindow(initialFiles[0] ?? null);

        for (const filePath of initialFiles.slice(1)) {
            await this.openNewWindow(filePath);
        }

        // La recherche de mise à jour est autonome : elle démarre ici, se répète
        // toutes les heures et notifie le renderer si une version plus récente existe.
        this.updater.startAutoCheck({
            isBusy: () => [...this.windows.values()].some(window => window.database.isInTransaction),
            getRestorableFiles: () => [...this.windows.values()]
                .filter(window => window.database.isOpen && window.database.driverType === "sqlite")
                .map(window => window.database.path)
                .filter((path): path is string => path !== null),
        });
    }

    /**
     * Clic sur l'icône du Dock alors qu'aucune fenêtre n'est ouverte (macOS).
     */
    public async onActivated(): Promise<void> {
        await this.openNewWindow();
    }

    /**
     * Enregistre une base dans l'historique interne et dans la liste des
     * documents récents du système, celle qu'expose le menu contextuel de la
     * barre des tâches.
     *
     * @param filePath - Chemin absolu de la base ouverte.
     * @param needsPassword - La base est chiffrée.
     */
    public rememberRecentFile(filePath: string, needsPassword: boolean): void {
        this.recentDatabases.addFile(filePath, needsPassword);
        app.addRecentDocument(filePath);
    }

    /**
     * Enregistre une connexion réseau dans l'historique, sans son mot de passe.
     */
    public rememberRecentNetwork(entry: Parameters<RecentDatabases["addNetwork"]>[0]): void {
        this.recentDatabases.addNetwork(entry);
    }

    /**
     * Enregistre une base SQLite distante dans l'historique, sans son jeton.
     * @param url - URL de la base (sans jeton).
     * @param hasToken - Un jeton a été fourni et devra être ressaisi.
     */
    public rememberRecentRemote(url: string, hasToken: boolean): void {
        this.recentDatabases.addRemote(url, hasToken);
    }

    public getRecentDatabases(): RecentDatabaseEntry[] {
        return this.recentDatabases.getAll();
    }

    /**
     * Informations de démarrage remises au renderer d'une fenêtre.
     * La base en attente est consommée : un rechargement ne la rouvre pas.
     */
    public getLoadAppResult(senderId: number): LoadAppResult {
        const window = this.getWindowBySenderId(senderId);

        return {
            windowType: this.windows.size <= 1 ? "primary" : "secondary",
            appName: environment.product.displayName,
            appVersion: environment.product.version,
            pendingFile: window?.takePendingFile() ?? null,
        };
    }

    /**
     * Ferme la fenêtre appelante, et l'application avec la dernière fenêtre.
     */
    public async closeWindow(senderId: number): Promise<void> {
        const window = this.getWindowBySenderId(senderId);

        if (window) {
            await window.database.close().catch(() => undefined);
            window.close();
        }
    }

    /**
     * Ferme toutes les fenêtres et quitte l'application.
     */
    public async quit(): Promise<void> {
        for (const window of [...this.windows.values()]) {
            await window.database.close().catch(() => undefined);
            window.close();
        }

        app.quit();
    }

    /**
     * Désenregistre une fenêtre fermée, quelle que soit la manière dont elle
     * l'a été (bouton de la titlebar, Alt+F4, barre des tâches).
     */
    private onWindowClosed(window: Window): void {
        this.windows.delete(window.id);

        // Sur Windows/Linux, fermer la dernière fenêtre quitte l'application.
        if (this.windows.size === 0 && process.platform !== "darwin") {
            app.quit();
        }
    }

    public async dispose(): Promise<void> {
        this.updater.stopAutoCheck();

        for (const window of this.windows.values()) {
            await window.database.dispose();
        }
    }
}
