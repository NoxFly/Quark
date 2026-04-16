import { Logger, WindowManager } from "@noxfly/noxus/main";
import { shell } from "electron/common";
import { BrowserWindow, BrowserWindowConstructorOptions, screen } from "electron/main";
import { join, basename } from "node:path";
import { environment } from "src/core/environment";
import type { DatabaseDriver } from "src/core/drivers/driver.interface";
import { createDriver } from "src/core/drivers/driver-registry";
import type { DatabaseDriverType } from "@shared/driver";
import type { DatabaseSchema } from "@shared/types";
import { AppEnv } from "src/core/env.dto";

const defaultWindowOptions: BrowserWindowConstructorOptions = {
    webPreferences: {
        devTools: environment.env === AppEnv.DEVELOPMENT,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false, // false pour supporter File.path dans le drag & drop — sécurisé grâce à contextIsolation
        preload: join(environment.rootDir, "preload.js"),
        webSecurity: true,
    },
    center: true,
    show: false,
    autoHideMenuBar: true,
    transparent: false,
    frame: false,
    icon: join(environment.publicDir, "favicon.ico"),
    minHeight: 750,
    minWidth: 1250,
    resizable: true,
    backgroundColor: "#000",
    accentColor: "#000000",
};

/**
 * 1 instance par fenêtre (renderer).
 * Chaque fenêtre gère une seule connexion DB via un driver interchangeable.
 */
export class Window {
    private win: BrowserWindow | null = null;
    private _database: DatabaseDriver = createDriver("sqlite");

    /**
     * Retourne le driver de base de données actif.
     */
    public get database(): DatabaseDriver {
        return this._database;
    }

    /**
     * Change le type de driver (pour ouvrir un autre type de base).
     * Ferme le driver actuel si une connexion est ouverte.
     */
    public async setDriverType(type: DatabaseDriverType): Promise<void> {
        if (this._database.isOpen) {
            await this._database.close();
        }
        this._database = createDriver(type);
    }

    /**
     *
     */
    public static async create(windowManager: WindowManager): Promise<Window> {
        const window = new Window(windowManager);
        await window.instantiate();
        return window;
    }

    /**
     *
     */
    private constructor(
        private readonly windowManager: WindowManager,
    ) {}

    /**
     *
     */
    public get id(): number {
        return this.win?.id ?? -1;
    }

    /**
     * Retourne le webContents.id (senderId pour Noxus).
     */
    public get senderId(): number {
        return this.win?.webContents?.id ?? -1;
    }

    /**
     *
     */
    public get isFocused(): boolean {
        return this.win?.isFocused() ?? false;
    }

    /**
     * Ouvre une base de données. Retourne true si un mot de passe est nécessaire.
     */
    public async openDatabase(filePath: string): Promise<boolean> {
        const needsPassword = await this.database.open(filePath);

        if (!needsPassword) {
            this.updateTitle();
        }

        return needsPassword;
    }

    /**
     * Déverrouille une base chiffrée.
     */
    public async unlockDatabase(password: string): Promise<void> {
        await this.database.unlock(password);
        this.updateTitle();
    }

    /**
     * Ferme la base de données.
     */
    public async closeDatabase(): Promise<void> {
        await this.database.close();
        this.updateTitle();
    }

    /**
     * Récupère le schéma de la base de données ouverte.
     */
    public async getDatabaseSchema(): Promise<DatabaseSchema | null> {
        if (!this.database.isOpen) {
            return null;
        }
        return await this.database.getSchema();
    }

    /**
     * Met à jour le titre de la fenêtre.
     */
    private updateTitle(): void {
        if (!this.win) {
            return;
        }

        const dbPath = this.database.path;
        const title = dbPath ? basename(dbPath) : "SQLite Editor";
        this.win.setTitle(title);
        this.win.webContents.send("title-changed", title);
    }

    /**
     * Met la fenêtre au premier plan.
     */
    public focus(): void {
        if (!this.win) {
            return;
        }

        if (this.win.isMinimized()) {
            this.win.restore();
        }

        this.win.focus();
    }

    /**
     *
     */
    private async instantiate(): Promise<void> {
        if (this.win) {
            return;
        }

        const primaryDisplay = screen.getPrimaryDisplay();
        const { width, height } = primaryDisplay.workAreaSize;

       const win = await this.windowManager.create({
            ...defaultWindowOptions,
            show: false,
            width: defaultWindowOptions.minWidth,
            height: defaultWindowOptions.minHeight,
            maxWidth: width,
            maxHeight: height,
        }, true);

        this.win = win;

        await this.load();
    }

    /**
     *
     */
    public close(): void {
        if (!this.win) {
            return;
        }

        this.win.close();
        this.win = null;
    }

    /**
     *
     */
    public reduce(): void {
        this.win?.minimize();
    }

    /**
     *
     */
    public maximize(): void {
        this.win?.maximize();
    }

    public toggleMaximize(): void {
        if (!this.win) {
            return;
        }

        if (this.win.isMaximized()) {
            this.win.unmaximize();
        }
        else {
            this.win.maximize();
        }
    }

    /**
     *
     */
    public toggleFullscreen(): void {
        if (!this.win) {
            return;
        }

        const isFullScreen = this.win.isFullScreen();

        if (!isFullScreen) {
            // Retirer les contraintes de taille max pour permettre le vrai plein écran
            this.win.setMaximumSize(0, 0);
        }

        this.win.setFullScreen(!isFullScreen);

        if (isFullScreen) {
            // Restaurer les contraintes de taille max après avoir quitté le plein écran
            const primaryDisplay = screen.getPrimaryDisplay();
            const { width, height } = primaryDisplay.workAreaSize;
            this.win.setMaximumSize(width, height);
        }
    }

    /**
     *
     */
    public getTitlebarState(): {
        maximizable: boolean;
        minimizable: boolean;
        closable: boolean;
    } {
        return {
            minimizable: this.win?.isMinimizable() ?? false,
            maximizable: this.win?.isMaximizable() ?? false,
            closable: this.win?.isClosable() ?? false,
        };
    }

    // --------

    /**
     *
     */
    private async load(cb?: (() => void) | null, launchPage?: string): Promise<void> {
        launchPage ||= "";

        if(!this.win) {
            return;
        }

        this.win.once("ready-to-show", () => {
            cb?.();
            this.win?.show();
        });

        // ouvre les liens _target="blank" (externes) dans le navigateur par défaut
        this.win.webContents.setWindowOpenHandler(({ url }) => {
            shell.openExternal(url);
            return {
                action: "deny",
            }; // pas forcément, à voir selon le cas
        });

        let url: string;

        switch (environment.env) {
            case "development":
                url = `http://localhost:4201/${launchPage ? `#/${launchPage}` : ""}`;
                break;

            default:
            case "production":
                url = `file://${join(environment.rootDir, "browser/index.html")}`;
                break;
        }

        Logger.comment(`Loading URL: ${url}`);

        await this.win.loadURL(url);

        if (/* !environment.development && */ launchPage) {
            this.win.webContents.send("navigate-to", launchPage);
        }
    }

    /**
     *
     */
    public is(win: BrowserWindow): boolean {
        return this.win?.id === win.id;
    }

    /**
     *
     */
    public async reloadRenderer(): Promise<void> {
        this.load();
    }
}
