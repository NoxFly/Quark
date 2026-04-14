import { contextBridge, ipcRenderer, webUtils } from "electron/renderer";
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
    getFilePathFromDrop: (file: File) => webUtils.getPathForFile(file),

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
    insertRow: (body) => ipcRenderer.invoke("db-insert-row", body),
    getRow: (body) => ipcRenderer.invoke("db-get-row", body),
    transactionAction: (action) => ipcRenderer.invoke("db-transaction", action),
    exportData: (body) => ipcRenderer.invoke("db-export", body),
    getWindowState: () => ipcRenderer.invoke("get-window-state"),
    execSql: (body) => ipcRenderer.invoke("db-exec-sql", body),
    importData: (body) => ipcRenderer.invoke("db-import-data", body),
    previewImport: (body) => ipcRenderer.invoke("db-preview-import", body),
    getIndexes: (table) => ipcRenderer.invoke("db-get-indexes", table),
    createIndex: (body) => ipcRenderer.invoke("db-create-index", body),
    dropIndex: (name) => ipcRenderer.invoke("db-drop-index", name),
    createTable: (body) => ipcRenderer.invoke("db-create-table", body),
    alterTable: (action) => ipcRenderer.invoke("db-alter-table", action),
    changePassword: (body) => ipcRenderer.invoke("db-change-password", body),
    batchUpdate: (body) => ipcRenderer.invoke("db-batch-update", body),
    dropTable: (tableName) => ipcRenderer.invoke("db-drop-table", tableName),
    getTablesSql: () => ipcRenderer.invoke("db-get-tables-sql") as Promise<{ name: string; sql: string }[]>,
    getRecentDatabases: () => ipcRenderer.invoke("get-recent-databases"),

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
