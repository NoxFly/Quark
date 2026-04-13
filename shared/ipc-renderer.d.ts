/**
 * Shared contract for the IPC bridge exposed by the preload script.
 */

export type TitlebarState = {
    minimizable: boolean;
    maximizable: boolean;
    closable: boolean;
};

export type LoadAppResult = {
    windowType: "primary" | "secondary";
    appName: string;
} & LocaleConfig;

export type NavigationRequest = string;

export interface IpcRendererBridge {
    requestReload(): Promise<void>;
    close(): Promise<void>;
    reduce(): Promise<void>;
    toggleFullscreen(): Promise<void>;
    getTitlebarState(): Promise<TitlebarState>;
    loadApp(): Promise<LoadAppResult>;
    onNavigationRequested(cb: (route: NavigationRequest) => void): void;
    whenDisplayErrorDialog(cb: (error: ErrorDialogPayload) => void): void;
}

export interface ErrorDialogPayload {
    title?: string;
    message: string;
    details?: string;
}

declare global {
    interface Window {
        ipcRenderer: IpcRendererBridge;
        __APP_LOAD_RESULT__?: LoadAppResult;
    }
}

export {};
