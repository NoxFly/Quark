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
    appVersion: string;
};

export type NavigationRequest = string;

export interface IpcRendererBridge {
    requestReload(): Promise<void>;
    close(): Promise<void>;
    reduce(): Promise<void>;
    toggleFullscreen(): Promise<void>;
    toggleMaximize(): Promise<void>;
    getTitlebarState(): Promise<TitlebarState>;
    loadApp(): Promise<LoadAppResult>;
    newWindow(): Promise<void>;
    quitApp(): Promise<void>;
    getFilePathFromDrop(file: File): string;

    openFileDialog(): Promise<string | null>;
    openFile(filePath: string): Promise<import("./types").R_OpenFileResponse>;
    submitPassword(password: string): Promise<import("./types").R_PasswordResponse>;
    closeFile(): Promise<import("./types").R_CloseFileResponse>;
    refreshDatabase(): Promise<import("./types").R_OpenFileResponse>;
    getTableData(body: import("./types").R_TableDataBody): Promise<import("./types").R_TableDataResponse>;
    updateCell(body: import("./types").R_UpdateCellBody): Promise<void>;
    deleteRows(body: import("./types").R_DeleteRowsBody): Promise<void>;
    insertRow(body: import("./types").R_InsertRowBody): Promise<import("./types").R_InsertRowResponse>;
    getRow(body: import("./types").R_GetRowBody): Promise<import("./types").R_GetRowResponse>;
    transactionAction(action: import("./types").R_TransactionAction): Promise<void>;
    exportData(body: import("./types").R_ExportBody): Promise<import("./types").R_ExportResponse>;
    getWindowState(): Promise<import("./types").R_WindowStateResponse>;

    onNavigationRequested(cb: (route: NavigationRequest) => void): void;
    onFileOpened(cb: (filePath: string) => void): void;
    onTitleChanged(cb: (title: string) => void): void;
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
