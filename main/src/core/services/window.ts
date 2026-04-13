import { Logger, WindowManager } from "@noxfly/noxus/main";
import { AppTab } from "src/core/services/app-tab";
import { shell } from "electron/common";
import { BrowserWindow, BrowserWindowConstructorOptions, screen } from "electron/main";
import { join } from "node:path";
import { environment } from "src/core/environment";

const defaultWindowOptions: BrowserWindowConstructorOptions = {
    webPreferences: {
        devTools: true,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
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
    minWidth: 950,
    resizable: true,
    backgroundColor: "#000",
    accentColor: "#000000",
};

/**
 * 1 instance par fenêtre (renderer)
 */
export class Window {
    private win: BrowserWindow | null = null;
    private readonly tabs = new Map<number, AppTab>();
    private focusedTabId = 0;

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
        private readonly windowManager: WindowManager
    ) {}

    /**
     *
     */
    public get id(): number {
        return this.win?.id ?? -1;
    }

    /**
     *
     */
    public get focusedTab(): AppTab | null {
        return this.tabs.get(this.focusedTabId) || null;
    }

    /**
     *
     */
    public get allTabs(): AppTab[] {
        return Array.from(this.tabs.values());
    }

    /**
     *
     */
    public get isFocused(): boolean {
        return this.win?.isFocused() ?? false;
    }

    /**
     *
     */
    public setFocusedTab(tabId: number): void {
        if (this.tabs.has(tabId)) {
            this.focusedTabId = tabId;
        }
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
        this.win?.setFullScreen(!this.win.isFullScreen());
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
