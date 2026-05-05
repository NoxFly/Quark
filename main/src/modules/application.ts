import { IApp, inject, Injectable, Logger, WindowManager } from "@noxfly/noxus/main";
import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron/main";
import { Window } from "src/core/services/window";
import { RecentDatabases } from "src/core/services/recent-databases";
import { normalize, basename } from "node:path";
import { environment } from "src/core/environment";
import type {
    R_AlterTableAction,
    R_BatchUpdateBody,
    R_ChangePasswordBody,
    R_CreateIndexBody,
    R_CreateTableBody,
    R_DeleteRowsBody,
    R_ExportBody,
    R_GetRowBody,
    R_ImportDataBody,
    R_InsertRowBody,
    R_NetworkConnectBody,
    R_SqlExecBody,
    R_TableDataBody,
    R_TransactionAction,
    R_UpdateCellBody,
} from "@shared/types";
import type { DatabaseDriverType } from "@shared/driver";
import { getAllDriverInfos } from "src/core/drivers/driver-registry";

@Injectable({ lifetime: "singleton" })
export class Application implements IApp {
    protected readonly windows = new Map<number, Window>();
    private readonly wm = inject(WindowManager);
    private readonly recentDatabases = new RecentDatabases();

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
     *
     */
    public async onReady(): Promise<void> {
        this.setupBridge();
        this.setupDbBridge();

        // Menu contextuel de la barre des tâches (clic droit sur l'icône)
        const dockMenu = Menu.buildFromTemplate([
            {
                label: "New Window",
                click: () => {
                    Window.create(this.wm).then(w => {
                        this.windows.set(w.id, w);
                    });
                },
            },
        ]);

        if (process.platform === "darwin") {
            app.dock?.setMenu(dockMenu);
        }
        else {
            // Sur Windows/Linux, on utilise le menu de la barre des tâches via jumplist
            app.setUserTasks([
                {
                    program: process.execPath,
                    arguments: "--new-window",
                    iconPath: process.execPath,
                    iconIndex: 0,
                    title: "New Window",
                    description: "Open a new window",
                },
            ]);
        }

        const baseWindow = await Window.create(this.wm);
        this.windows.set(baseWindow.id, baseWindow);
    }

    public async onActivated(): Promise<void> {}

    public async dispose(): Promise<void> {
        for (const window of this.windows.values()) {
            await window.database.close();
        }
    }

    /**
     * Setup des IPC pour la gestion de fenêtre.
     */
    private setupBridge(): void {
        ipcMain.handle("close-app", async (_event) => {
            const window = this.getWindowBySenderId(_event.sender.id);

            if (window) {
                await window.database.close();
                this.windows.delete(window.id);
                window.close();
            }

            // Si c'était la dernière fenêtre, l'app se ferme naturellement sur macOS
            // Sur Windows/Linux, on quitte explicitement
            if (this.windows.size === 0) {
                app.quit();
            }
        });

        ipcMain.handle("new-window", async () => {
            const newWin = await Window.create(this.wm);
            this.windows.set(newWin.id, newWin);
        });

        ipcMain.handle("quit-app", async () => {
            for (const window of this.windows.values()) {
                await window.database.close();
                window.close();
            }
            this.windows.clear();
            app.quit();
        });

        ipcMain.handle("load-app", (_event) => {
            const isFirstWindow = this.windows.size <= 1;
            return {
                windowType: isFirstWindow ? "primary" : "secondary",
                appName: environment.product.displayName,
                appVersion: environment.product.version,
            };
        });

        ipcMain.handle("reduce-app", (_event) => {
            const window = this.getWindowBySenderId(_event.sender.id);
            window?.reduce();
        });

        ipcMain.handle("toggle-fullscreen", (_event) => {
            const window = this.getWindowBySenderId(_event.sender.id);
            window?.toggleFullscreen();
        });

        ipcMain.handle("toggle-maximize", (_event) => {
            const window = this.getWindowBySenderId(_event.sender.id);
            window?.toggleMaximize();
        });

        ipcMain.handle("get-titlebar-state", (_event) => {
            const window = this.getWindowBySenderId(_event.sender.id);
            return window?.getTitlebarState() ?? {
                minimizable: false,
                maximizable: false,
                closable: false,
            };
        });

        ipcMain.handle("request-reload", (_event) => {
            const window = this.getWindowBySenderId(_event.sender.id);
            window?.reloadRenderer();
        });

        ipcMain.handle("get-window-state", async (_event) => {
            const window = this.getWindowBySenderId(_event.sender.id);
            if (!window) {
                return { inTransaction: false, selectedTable: null, database: null, filePath: null, driverType: null, driverInfo: null };
            }

            const db = window.database;
            return {
                inTransaction: db.isInTransaction,
                selectedTable: null, // La table sélectionnée est un état renderer uniquement
                database: db.isOpen ? await db.getSchema() : null,
                filePath: db.path,
                driverType: db.driverType,
                driverInfo: db.info,
            };
        });

        ipcMain.handle("open-file-dialog", async (_event) => {
            const win = BrowserWindow.fromWebContents(_event.sender);
            return await this.openFileDialog(win);
        });
    }

    /**
     * Setup des IPC pour les opérations sur la base de données.
     */
    private setupDbBridge(): void {
        ipcMain.handle("db-open-file", async (_event, filePath: string) => {
            const window = this.getWindowBySenderId(_event.sender.id);
            if (!window) {
                throw new Error("Window not found");
            }

            // Vérifier si ce fichier est déjà ouvert dans une autre fenêtre
            const existing = this.findWindowByFilePath(filePath);
            if (existing && existing.id !== window.id) {
                existing.focus();
                return { needsPassword: false, database: null, alreadyOpen: true };
            }

            const needsPassword = await window.openDatabase(filePath);

            // Toujours enregistrer dans l'historique — encrypted=true si mot de passe requis
            this.recentDatabases.addFile(filePath, needsPassword);

            return {
                needsPassword,
                database: needsPassword ? null : await window.getDatabaseSchema(),
            };
        });

        ipcMain.handle("db-submit-password", async (_event, password: string) => {
            const window = this.getWindowBySenderId(_event.sender.id);
            if (!window) {
                throw new Error("Window not found");
            }

            await window.unlockDatabase(password);

            // L'entrée est déjà dans l'historique depuis db-open-file (requiresPassword: true)

            return {
                database: await window.getDatabaseSchema(),
            };
        });

        ipcMain.handle("db-close-file", async (_event) => {
            const window = this.getWindowBySenderId(_event.sender.id);
            if (!window) {
                throw new Error("Window not found");
            }

            await window.closeDatabase();
            return { closed: true };
        });

        ipcMain.handle("db-table-data", async (_event, body: R_TableDataBody) => {
            const window = this.getWindowBySenderId(_event.sender.id);
            if (!window) {
                throw new Error("Window not found");
            }

            return await window.database.getTableData(
                body.table,
                body.offset,
                body.limit,
                body.orderBy,
                body.orderDir,
                body.filter,
                body.filterMode,
            );
        });

        ipcMain.handle("db-update-cell", async (_event, body: R_UpdateCellBody) => {
            const window = this.getWindowBySenderId(_event.sender.id);
            if (!window) {
                throw new Error("Window not found");
            }

            await window.database.updateCell(body.table, body.rowid, body.column, body.value);
        });

        ipcMain.handle("db-delete-rows", async (_event, body: R_DeleteRowsBody) => {
            const window = this.getWindowBySenderId(_event.sender.id);
            if (!window) {
                throw new Error("Window not found");
            }

            await window.database.deleteRows(body.table, body.rowids);
        });

        ipcMain.handle("db-transaction", async (_event, action: R_TransactionAction) => {
            const window = this.getWindowBySenderId(_event.sender.id);
            if (!window) {
                throw new Error("Window not found");
            }

            switch (action) {
                case "begin":
                    await window.database.beginTransaction();
                    break;
                case "commit":
                    await window.database.commit();
                    break;
                case "rollback":
                    await window.database.rollback();
                    break;
            }
        });

        ipcMain.handle("db-export", async (_event, body: R_ExportBody) => {
            const window = this.getWindowBySenderId(_event.sender.id);
            if (!window) {
                throw new Error("Window not found");
            }

            return await window.database.exportData(body.table, body.format, body.rowids, body.filter);
        });

        ipcMain.handle("db-insert-row", async (_event, body: R_InsertRowBody) => {
            const window = this.getWindowBySenderId(_event.sender.id);
            if (!window) {
                throw new Error("Window not found");
            }

            const rowid = await window.database.insertRow(body.table, body.values);
            const record = await window.database.getRow(body.table, rowid);

            return { rowid, record };
        });

        ipcMain.handle("db-get-row", async (_event, body: R_GetRowBody) => {
            const window = this.getWindowBySenderId(_event.sender.id);
            if (!window) {
                throw new Error("Window not found");
            }

            const record = await window.database.getRow(body.table, body.rowid);
            return { record };
        });

        ipcMain.handle("db-refresh", async (_event) => {
            const window = this.getWindowBySenderId(_event.sender.id);
            if (!window) {
                throw new Error("Window not found");
            }

            const dbPath = window.database.path;
            if (!dbPath) {
                return { database: null };
            }

            // Ferme et réouvre la même base de données
            await window.closeDatabase();
            const needsPassword = await window.openDatabase(dbPath);

            return {
                needsPassword,
                database: needsPassword ? null : await window.getDatabaseSchema(),
            };
        });

        ipcMain.handle("db-exec-sql", async (_event, body: R_SqlExecBody) => {
            const window = this.getWindowBySenderId(_event.sender.id);
            if (!window) {
                throw new Error("Window not found");
            }

            return await window.database.execSql(body.sql);
        });

        ipcMain.handle("db-import-data", async (_event, body: R_ImportDataBody) => {
            const window = this.getWindowBySenderId(_event.sender.id);
            if (!window) {
                throw new Error("Window not found");
            }

            await window.database.importData(body.table, body.format, body.data, body.mode);
        });

        ipcMain.handle("db-preview-import", async (_event, body: Omit<R_ImportDataBody, "mode">) => {
            const window = this.getWindowBySenderId(_event.sender.id);
            if (!window) {
                throw new Error("Window not found");
            }

            return await window.database.previewImport(body.table, body.format, body.data);
        });

        ipcMain.handle("db-get-indexes", async (_event, table: string) => {
            const window = this.getWindowBySenderId(_event.sender.id);
            if (!window) {
                throw new Error("Window not found");
            }

            return { indexes: await window.database.getIndexes(table) };
        });

        ipcMain.handle("db-create-index", async (_event, body: R_CreateIndexBody) => {
            const window = this.getWindowBySenderId(_event.sender.id);
            if (!window) {
                throw new Error("Window not found");
            }

            await window.database.createIndex(body.table, body.name, body.columns, body.unique);
        });

        ipcMain.handle("db-drop-index", async (_event, name: string) => {
            const window = this.getWindowBySenderId(_event.sender.id);
            if (!window) {
                throw new Error("Window not found");
            }

            await window.database.dropIndex(name);
        });

        ipcMain.handle("db-create-table", async (_event, body: R_CreateTableBody) => {
            const window = this.getWindowBySenderId(_event.sender.id);
            if (!window) {
                throw new Error("Window not found");
            }

            await window.database.createTable(body.name, body.columns, body.ifNotExists);
        });

        ipcMain.handle("db-alter-table", async (_event, action: R_AlterTableAction) => {
            const window = this.getWindowBySenderId(_event.sender.id);
            if (!window) {
                throw new Error("Window not found");
            }

            await window.database.alterTable(action);
        });

        ipcMain.handle("db-change-password", async (_event, body: R_ChangePasswordBody) => {
            const window = this.getWindowBySenderId(_event.sender.id);
            if (!window) {
                throw new Error("Window not found");
            }

            await window.database.changePassword(body.newPassword);
        });

        ipcMain.handle("db-batch-update", async (_event, body: R_BatchUpdateBody) => {
            const window = this.getWindowBySenderId(_event.sender.id);
            if (!window) {
                throw new Error("Window not found");
            }

            await window.database.batchUpdate(body.table, body.rowids, body.column, body.value);
        });

        ipcMain.handle("db-drop-table", async (_event, tableName: string) => {
            const window = this.getWindowBySenderId(_event.sender.id);
            if (!window) {
                throw new Error("Window not found");
            }

            await window.database.dropTable(tableName);
        });

        ipcMain.handle("db-get-tables-sql", async (_event) => {
            const window = this.getWindowBySenderId(_event.sender.id);
            if (!window) {
                throw new Error("Window not found");
            }

            return await window.database.getTablesSql();
        });

        ipcMain.handle("get-recent-databases", () => {
            return this.recentDatabases.getAll();
        });

        ipcMain.handle("db-set-driver-type", async (_event, type: DatabaseDriverType) => {
            const window = this.getWindowBySenderId(_event.sender.id);
            if (!window) {
                throw new Error("Window not found");
            }
            await window.setDriverType(type);
        });

        ipcMain.handle("db-connect-network", async (_event, body: R_NetworkConnectBody) => {
            const window = this.getWindowBySenderId(_event.sender.id);
            if (!window) {
                throw new Error("Window not found");
            }

            // Connexion pure — ne charge pas le schéma pour répondre immédiatement.
            // Le schéma est chargé séparément via `db-get-schema` (phase 2).
            const uri = `${body.username}:${body.password}@${body.host}:${body.port}/${body.database}`;
            await window.setDriverType(body.driverType);
            await window.openDatabase(uri);

            // Enregistrer dans l'historique sans le mot de passe
            this.recentDatabases.addNetwork({
                driverType: body.driverType,
                host: body.host,
                port: body.port,
                username: body.username,
                database: body.database,
                hasEmptyPassword: body.password.length === 0,
            });

            return { connected: true };
        });

        ipcMain.handle("db-get-schema", async (_event) => {
            const window = this.getWindowBySenderId(_event.sender.id);
            if (!window || !window.database.isOpen) {
                return null;
            }
            return await window.getDatabaseSchema();
        });

        ipcMain.handle("db-get-driver-infos", () => {
            return getAllDriverInfos();
        });
    }
}
