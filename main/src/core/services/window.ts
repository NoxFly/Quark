import { Logger, WindowManager } from "@noxfly/noxus/main";
import { shell } from "electron/common";
import { BrowserWindow, BrowserWindowConstructorOptions, dialog, screen } from "electron/main";
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
    minHeight: 400,
    minWidth: 600,
    resizable: true,
    // Couleur de fond initiale + couleur de la bordure DWM (Windows 11) d'une fenêtre
    // frameless. En blanc pour s'accorder à l'application claire (au lieu du noir).
    backgroundColor: "#ffffff",
};

/**
 * Délai au-delà duquel la fenêtre est affichée même si `ready-to-show` n'a jamais
 * été émis. Sans ce filet, un renderer qui échoue à peindre laisse une fenêtre
 * invisible et une application apparemment morte.
 */
const READY_TO_SHOW_FALLBACK_MS = 8_000;

/**
 * 1 instance par fenêtre (renderer).
 * Chaque fenêtre gère une seule connexion DB via un driver interchangeable.
 */
export class Window {
    private win: BrowserWindow | null = null;
    private _database: DatabaseDriver = createDriver("sqlite");
    private showFallbackTimer: ReturnType<typeof setTimeout> | null = null;

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
        const title = dbPath ? basename(dbPath) : "";
        this.win.setTitle(title);
        this.win.webContents.send("title-changed", title);
    }

    /**
     * Pousse un événement vers le renderer de cette fenêtre.
     * @param channel - Canal IPC écouté côté preload.
     * @param payload - Données transmises au renderer.
     */
    public sendToRenderer(channel: string, ...payload: unknown[]): void {
        this.win?.webContents.send(channel, ...payload);
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
            width: 1250,
            height: 750,
            maxWidth: width,
            maxHeight: height,
        }, true);

        this.win = win;

        // Les écouteurs de cycle de vie sont posés une seule fois pour la durée de vie
        // de la fenêtre : `load()` peut être rappelé (Ctrl+Alt+R) et les réenregistrer
        // à chaque passage accumulerait des écouteurs sur le même émetteur.
        this.registerLifecycleHandlers(win);

        await this.load();
    }

    /**
     *
     */
    public close(): void {
        if (!this.win) {
            return;
        }

        this.clearShowFallback();
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
     * Enregistre les écouteurs de cycle de vie et de diagnostic de la fenêtre.
     *
     * Sans eux, un échec de chargement, un crash du process de rendu ou une erreur
     * de preload se traduisent par une fenêtre blanche muette : aucun message pour
     * l'utilisateur, aucune trace exploitable dans les logs.
     */
    private registerLifecycleHandlers(win: BrowserWindow): void {
        win.on("ready-to-show", () => {
            this.clearShowFallback();
            win.show();
        });

        win.on("unresponsive", () => {
            Logger.critical(`Renderer ${win.id} is unresponsive.`);
        });

        win.on("responsive", () => {
            Logger.info(`Renderer ${win.id} is responsive again.`);
        });

        win.webContents.on("preload-error", (_event, preloadPath, error) => {
            Logger.critical(`Preload script failed (${preloadPath}): ${error.stack ?? error.message}`);
            this.reportFatal("Preload error", error.message);
        });

        win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
            // -3 = ERR_ABORTED : émis quand une navigation en remplace une autre, sans conséquence.
            if (!isMainFrame || errorCode === -3) {
                return;
            }

            Logger.critical(`Failed to load ${validatedURL}: ${errorDescription} (${errorCode})`);
            this.reportFatal("Loading error", `${errorDescription} (${errorCode})\n${validatedURL}`);
        });

        win.webContents.on("render-process-gone", (_event, details) => {
            Logger.critical(`Render process gone: reason=${details.reason}, exitCode=${details.exitCode}`);

            // « clean-exit » correspond à la fermeture volontaire de la fenêtre.
            if (details.reason === "clean-exit") {
                return;
            }

            this.reportFatal("Renderer crashed", `Reason: ${details.reason} (exit code ${details.exitCode})`);
        });

        // Toute navigation hors du document de l'application (drop d'un fichier sur
        // une zone non gérée, lien interne mal formé) remplacerait l'interface par la
        // cible : plus de titlebar, plus de raccourcis, aucun moyen de revenir. On la refuse.
        win.webContents.on("will-navigate", (event, url) => {
            if (this.isApplicationUrl(url)) {
                return;
            }

            Logger.warn(`Blocked in-window navigation to ${url}`);
            event.preventDefault();
        });
    }

    /**
     * Indique si l'URL correspond au document de l'application elle-même.
     */
    private isApplicationUrl(url: string): boolean {
        const current = this.win?.webContents.getURL();

        if (!current) {
            return false;
        }

        // Le routage Angular est en mode hash : seule la partie avant `#` identifie le document.
        const strip = (value: string): string => value.split("#")[0] ?? value;

        return strip(url) === strip(current);
    }

    /**
     * Affiche une erreur fatale du renderer dans une boîte de dialogue native.
     * Le dialogue natif est le seul canal fiable ici : l'interface Angular est,
     * par définition, indisponible.
     */
    private reportFatal(title: string, message: string): void {
        this.clearShowFallback();
        this.win?.show();

        const answer = dialog.showMessageBoxSync({
            type: "error",
            title: `${environment.product.displayName} — ${title}`,
            message: `${title}\n\n${message}`,
            buttons: ["Reload", "Close"],
            defaultId: 0,
            cancelId: 1,
        });

        if (answer === 0) {
            void this.reloadRenderer();
            return;
        }

        this.close();
    }

    /**
     * Arme le filet de sécurité qui affiche la fenêtre même si `ready-to-show`
     * n'est jamais émis.
     */
    private armShowFallback(): void {
        this.clearShowFallback();

        this.showFallbackTimer = setTimeout(() => {
            this.showFallbackTimer = null;

            if (this.win && !this.win.isVisible()) {
                Logger.warn(`ready-to-show never fired after ${READY_TO_SHOW_FALLBACK_MS}ms — showing window anyway.`);
                this.win.show();
            }
        }, READY_TO_SHOW_FALLBACK_MS);
    }

    /**
     *
     */
    private clearShowFallback(): void {
        if (this.showFallbackTimer !== null) {
            clearTimeout(this.showFallbackTimer);
            this.showFallbackTimer = null;
        }
    }

    /**
     * Charge (ou recharge) le document du renderer dans la fenêtre.
     */
    private async load(launchPage?: string): Promise<void> {
        const win = this.win;

        if (!win) {
            return;
        }

        this.armShowFallback();

        // ouvre les liens _target="blank" (externes) dans le navigateur par défaut
        win.webContents.setWindowOpenHandler(({ url }) => {
            shell.openExternal(url);

            return {
                action: "deny",
            };
        });

        try {
            if (environment.env === AppEnv.DEVELOPMENT) {
                const url = `http://localhost:4201/${launchPage ? `#/${launchPage}` : ""}`;
                Logger.comment(`Loading URL: ${url}`);
                await win.loadURL(url);
            }
            else {
                // `loadFile` encode lui-même le chemin. Une URL `file://` construite à
                // la main casse dès que le dossier d'installation contient un espace,
                // un accent ou un `#` — écran blanc chez l'utilisateur, jamais chez le
                // développeur.
                const filePath = join(environment.rendererDir, "index.html");
                Logger.comment(`Loading file: ${filePath}`);
                await win.loadFile(filePath, launchPage ? { hash: `/${launchPage}` } : undefined);
            }
        }
        catch (error) {
            // `did-fail-load` a déjà rapporté le détail ; on empêche seulement le rejet
            // de remonter en unhandledRejection.
            Logger.critical(`Renderer load failed: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }

        if (launchPage) {
            win.webContents.send("navigate-to", launchPage);
        }
    }

    /**
     *
     */
    public is(win: BrowserWindow): boolean {
        return this.win?.id === win.id;
    }

    /**
     * Recharge le document du renderer (Ctrl+Alt+R).
     */
    public async reloadRenderer(): Promise<void> {
        await this.load();
    }
}
