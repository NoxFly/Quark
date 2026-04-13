import { contextBridge, ipcRenderer } from "electron/renderer";
import type {
    ErrorDialogPayload,
    IpcRendererBridge,
    LoadAppResult,
    TitlebarState,
} from "@shared/ipc-renderer";
import { exposeNoxusBridge } from "@noxfly/noxus/preload";

// .invoke -> front sends to back
// .on -> back sends to front

const ensureLoadAppResult = async (): Promise<LoadAppResult> => {
    const result = (await ipcRenderer.invoke("load-app")) as LoadAppResult;
    return result;
};

const api: IpcRendererBridge = {
    // window
    requestReload: () => ipcRenderer.invoke("request-reload"),
    close: () => ipcRenderer.invoke("close-app"),
    reduce: () => ipcRenderer.invoke("reduce-app"),
    toggleMaximize: () => ipcRenderer.invoke("toggle-maximize"),
    toggleFullscreen: () => ipcRenderer.invoke("toggle-fullscreen"),
    getTitlebarState: () => ipcRenderer.invoke("get-titlebar-state") as Promise<TitlebarState>,
    newWindow: () => ipcRenderer.invoke("new-window"),
    quitApp: () => ipcRenderer.invoke("quit-app"),

    loadApp: () => ensureLoadAppResult(),

    // File / DB
    openFileDialog: () => ipcRenderer.invoke("open-file-dialog"),
    openFile: (filePath) => ipcRenderer.invoke("db-open-file", filePath),
    submitPassword: (password) => ipcRenderer.invoke("db-submit-password", password),
    closeFile: () => ipcRenderer.invoke("db-close-file"),
    refreshDatabase: () => ipcRenderer.invoke("db-refresh"),
    getTableData: (body) => ipcRenderer.invoke("db-table-data", body),
    updateCell: (body) => ipcRenderer.invoke("db-update-cell", body),
    deleteRows: (body) => ipcRenderer.invoke("db-delete-rows", body),
    transactionAction: (action) => ipcRenderer.invoke("db-transaction", action),
    exportData: (body) => ipcRenderer.invoke("db-export", body),

    // Events from main
    onNavigationRequested: (cb) => {
        ipcRenderer.removeAllListeners("navigate-to");
        ipcRenderer.on("navigate-to", (_event, target: string) => cb(target));
    },

    onFileOpened: (cb) => {
        ipcRenderer.removeAllListeners("open-file");
        ipcRenderer.on("open-file", (_event, filePath: string) => cb(filePath));
    },

    onTitleChanged: (cb) => {
        ipcRenderer.removeAllListeners("title-changed");
        ipcRenderer.on("title-changed", (_event, title: string) => cb(title));
    },

    whenDisplayErrorDialog: (cb) => {
        ipcRenderer.removeAllListeners("display-error-dialog");
        ipcRenderer.on("display-error-dialog", (_event, error: ErrorDialogPayload) => cb(error));
    },
};

contextBridge.exposeInMainWorld("ipcRenderer", api);

exposeNoxusBridge();
