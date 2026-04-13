import { IApp, inject, Injectable, WindowManager } from "@noxfly/noxus/main";
import { BrowserWindow, ipcMain } from "electron/main";
import { Window } from "src/core/services/window";

@Injectable({ lifetime: "singleton" })
export class Application implements IApp {
    protected readonly windows = new Map<number, Window>();
    private readonly wm = inject(WindowManager);

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
    public getWindowById(senderId: number): Window | null {
        return this.windows.get(senderId) || null;
    }

    /**
     *
     */
    public async onReady(): Promise<void> {
        this.setupShortcuts();
        this.setupBridge();

        const baseWindow = await Window.create(this.wm);
        this.windows.set(baseWindow.id, baseWindow);
    }

    public async onActivated(): Promise<void> {}
    public async dispose(): Promise<void> {}

    private setupShortcuts(): void {}

    /**
     *
     */
    private setupBridge(): void {
        ipcMain.handle("close-app", () => {
            const focusedWindow = BrowserWindow.getFocusedWindow();
            const window = this.windows.get(focusedWindow?.id!);
            window?.close();
        });

        ipcMain.handle("reduce-app", () => {
            const focusedWindow = BrowserWindow.getFocusedWindow();
            const window = this.windows.get(focusedWindow?.id!);
            window?.reduce();
        });

        ipcMain.handle("toggle-fullscreen", () => {
            const focusedWindow = BrowserWindow.getFocusedWindow();
            const window = this.windows.get(focusedWindow?.id!);
            window?.toggleMaximize();
        });

        ipcMain.handle("get-titlebar-state", () => {
            const focusedWindow = BrowserWindow.getFocusedWindow();
            const window = this.windows.get(focusedWindow?.id!);
            window?.close();
        });

        ipcMain.handle("request-reload", () => {
            const focusedWindow = BrowserWindow.getFocusedWindow();
            const window = this.windows.get(focusedWindow?.id!);
            window?.reloadRenderer();
        });
    }
}
