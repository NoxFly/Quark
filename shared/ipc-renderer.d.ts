/*
 * Quark
 * Copyright (C) 2026 NoxFly
 *
 * FR : Ce programme est un logiciel libre ; vous pouvez le redistribuer ou le
 * modifier selon les termes de la GNU Affero General Public License, version 3,
 * telle que publiée par la Free Software Foundation. Il est distribué dans
 * l'espoir d'être utile, mais SANS AUCUNE GARANTIE. Voir le fichier LICENSE.
 *
 * EN : This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License, version 3, as
 * published by the Free Software Foundation. It is distributed in the hope that
 * it will be useful, but WITHOUT ANY WARRANTY. See the LICENSE file.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Contrat de l'API IPC du renderer. Elle est implémentée côté renderer au-dessus
 * des routes Noxus (`NoxusService.ipc`) : le preload n'expose que `PreloadApi`.
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
    /**
     * Base passée en ligne de commande (double-clic sur un fichier) à ouvrir dès
     * que le renderer est prêt. `null` si l'application a été lancée sans fichier.
     */
    pendingFile: string | null;
};

export type NavigationRequest = string;

/**
 * Seule API exposée par le preload en plus du pont Noxus.
 */
export interface PreloadApi {
    /** Chemin absolu d'un fichier déposé dans la fenêtre. */
    getPathForFile(file: File): string;
}

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
    submitPassword(password: string, remember?: boolean): Promise<import("./types").R_PasswordResponse>;
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
    /** Exécute du SQL brut ; seule la première page d'un SELECT est renvoyée. */
    execSql(body: import("./types").R_SqlExecBody): Promise<import("./types").R_SqlExecResponse>;
    /** Lit une page supplémentaire d'un résultat SQL conservé par le main. */
    fetchSqlRows(body: import("./types").R_SqlRowsBody): Promise<import("./types").R_SqlRowsResponse>;
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
    /** Retire une entrée de l'historique des bases récentes (menu contextuel). */
    removeRecentDatabase(entry: RecentDatabaseEntry): Promise<void>;
    /** Révèle un fichier dans l'explorateur du système (menu contextuel d'une base récente). */
    revealInExplorer(filePath: string): Promise<void>;
    setDriverType(type: import("./driver").DatabaseDriverType): Promise<void>;
    connectNetwork(body: import("./types").R_NetworkConnectBody): Promise<import("./types").R_ConnectNetworkResponse>;
    /** Ouvre une base SQLite distante (libSQL / Turso) dans la fenêtre. */
    connectRemoteSqlite(body: import("./types").R_RemoteSqliteBody): Promise<import("./types").R_ConnectNetworkResponse>;
    /** Teste une connexion sans l'ouvrir dans la fenêtre. */
    testConnection(body: import("./types").R_TestConnectionBody): Promise<import("./connection").ConnectionTestResult>;
    /** Vide une table (DELETE de toutes les lignes, journalisé dans le diff de session). */
    truncateTable(tableName: string): Promise<void>;
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
    connFolders(): Promise<import("./connection").ConnectionFolder[]>;
    connFolderCreate(input: import("./connection").ConnectionFolderInput): Promise<import("./connection").ConnectionFolder>;
    connFolderUpdate(id: string, input: import("./connection").ConnectionFolderInput): Promise<import("./connection").ConnectionFolder>;
    /** Supprime un dossier ; ses profils sont déplacés dans le premier dossier restant. */
    connFolderDelete(id: string): Promise<void>;
    /** Active / désactive la protection du coffre par mot de passe maître. */
    connSetMasterPassword(body: import("./connection").ConnectionMasterPasswordBody): Promise<void>;

    onNavigationRequested(cb: (route: NavigationRequest) => void): void;
    onFileOpened(cb: (filePath: string) => void): void;
    onTitleChanged(cb: (title: string) => void): void;
    whenDisplayErrorDialog(cb: (error: ErrorDialogPayload) => void): void;

    /** Notifié quand la recherche automatique détecte une version plus récente. */
    onUpdateAvailable(cb: (info: import("./update").UpdateInfo) => void): void;
    /** Notifié au début et à la fin de chaque recherche automatique (périodique ou de démarrage). */
    onUpdateChecking(cb: (checking: boolean) => void): void;
    /** Notifié pendant le téléchargement de l'installeur. */
    onUpdateProgress(cb: (progress: import("./update").UpdateProgress) => void): void;
    /** L'installeur est téléchargé et vérifié : la mise à jour peut être lancée. */
    onUpdateDownloaded(cb: (info: import("./update").UpdateInfo) => void): void;
    /** Le téléchargement a échoué ; `error` en donne la raison. */
    onUpdateDownloadFailed(cb: (error: string) => void): void;

    /**
     * Notifié à chaque modification enregistrée dans le diff de session.
     * Ne transporte que les compteurs : le contenu est chargé à la demande.
     */
    onSessionDiffChanged(cb: (summary: import("./session-diff").SessionDiffSummary) => void): void;
}

export interface ErrorDialogPayload {
    title?: string;
    message: string;
    details?: string;
}

export interface RecentDatabaseEntry {
    /** Type de connexion : fichier local, connexion réseau ou base SQLite distante. */
    connectionType: "file" | "network" | "remote";
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
    /**
     * Connexion réseau établie par chaîne de connexion plutôt que par champs
     * séparés (MongoDB : le formulaire ne collecte qu'une URI). Sans ce champ,
     * `host`/`port` restent vides et rouvrir l'entrée échouerait ; le sous-titre
     * affiché en est aussi dérivé (identifiants toujours exclus).
     */
    uri?: string;
    // Base SQLite distante (le jeton n'est pas conservé)
    url?: string;
}

declare global {
    interface Window {
        quark: PreloadApi;
    }
}
