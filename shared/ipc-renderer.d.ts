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
    execSql(body: import("./types").R_SqlExecBody): Promise<import("./types").R_SqlExecResponse>;
    importData(body: import("./types").R_ImportDataBody): Promise<void>;
    previewImport(body: Omit<import("./types").R_ImportDataBody, "mode">): Promise<import("./types").R_ImportPreviewResponse>;
    getIndexes(table: string): Promise<import("./types").R_GetIndexesResponse>;
    createIndex(body: import("./types").R_CreateIndexBody): Promise<void>;
    dropIndex(name: string): Promise<void>;
    createTable(body: import("./types").R_CreateTableBody): Promise<void>;
    alterTable(action: import("./types").R_AlterTableAction): Promise<void>;
    changePassword(body: import("./types").R_ChangePasswordBody): Promise<void>;
    batchUpdate(body: import("./types").R_BatchUpdateBody): Promise<void>;
    dropTable(tableName: string): Promise<void>;
    getTablesSql(): Promise<{ name: string; sql: string }[]>;
    getRecentDatabases(): Promise<RecentDatabaseEntry[]>;
    setDriverType(type: import("./driver").DatabaseDriverType): Promise<void>;
    connectNetwork(body: import("./types").R_NetworkConnectBody): Promise<import("./types").R_ConnectNetworkResponse>;
    getSchema(): Promise<import("./types").DatabaseSchema | null>;
    getAllDriverInfos(): Promise<import("./driver").DriverInfo[]>;

    // Coffre de connexions sauvegardées
    connVaultStatus(): Promise<import("./connection").ConnectionVaultStatus>;
    connInitialize(masterPassword: string): Promise<void>;
    connUnlock(masterPassword: string): Promise<boolean>;
    connLock(): Promise<void>;
    connList(): Promise<import("./connection").ConnectionProfile[]>;
    connCreate(input: import("./connection").ConnectionProfileInput): Promise<import("./connection").ConnectionProfile>;
    connUpdate(id: string, input: import("./connection").ConnectionProfileInput): Promise<import("./connection").ConnectionProfile>;
    connDelete(id: string): Promise<void>;
    connConnect(id: string): Promise<import("./connection").ConnectionConnectResult>;
    connExport(ids: string[], passphrase: string): Promise<boolean>;
    connImport(passphrase: string): Promise<number>;

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

export interface RecentDatabaseEntry {
    /** Type de connexion : fichier local ou connexion réseau. */
    connectionType: "file" | "network";
    /** Driver utilisé pour cette connexion. */
    driverType: import("./driver").DatabaseDriverType;
    /** Nom affiché dans la liste (nom de fichier ou nom de base de données). */
    displayName: string;
    /** Sous-titre affiché (chemin du dossier ou adresse du serveur). */
    displaySubtitle: string;
    /** Timestamp de la dernière ouverture. */
    lastOpened: number;
    /** Indique si la connexion nécessite un mot de passe (fichier chiffré ou connexion réseau). */
    requiresPassword: boolean;
    // Connexion fichier
    filePath?: string;
    // Connexion réseau (aucun mot de passe stocké)
    host?: string;
    port?: number;
    username?: string;
    database?: string;
}

declare global {
    interface Window {
        ipcRenderer: IpcRendererBridge;
        __APP_LOAD_RESULT__?: LoadAppResult;
    }
}

export {};
