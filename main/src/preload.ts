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
    toggleFullscreen: () => ipcRenderer.invoke("toggle-fullscreen"),
    getTitlebarState: () => ipcRenderer.invoke("get-titlebar-state") as Promise<TitlebarState>,

    loadApp: () => ensureLoadAppResult(),
    onNavigationRequested: (cb) => {
        ipcRenderer.removeAllListeners("navigate-to");
        ipcRenderer.on("navigate-to", (_event, target: string) => cb(target));
    },

    whenDisplayErrorDialog: (cb) => {
        ipcRenderer.removeAllListeners("display-error-dialog");
        ipcRenderer.on("display-error-dialog", (_event, error: ErrorDialogPayload) => cb(error));
    },
};

contextBridge.exposeInMainWorld("ipcRenderer", api);

exposeNoxusBridge();
