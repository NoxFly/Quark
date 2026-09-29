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

import type { RendererEventRegistry, RendererEventSubscription, RequestOptions } from "@noxfly/noxus/renderer";
import type { IpcRendererBridge } from "@shared/ipc-renderer";

/** Sous-ensemble du client Noxus dont le bridge a besoin. */
export interface NoxusRequester {
    readonly events: RendererEventRegistry;
    request<TResponse, TBody = unknown>(
        request: { method: "GET" | "POST"; path: string; body?: TBody },
        options?: RequestOptions,
    ): Promise<TResponse>;
}

/**
 * Pas d'échéance pour les opérations dont la durée dépend de la base ou de
 * l'utilisateur : une requête SQL lourde, un export, un import, un dialogue
 * natif. Les échouer au bout de 10 s (défaut de Noxus) laissait le main
 * poursuivre l'opération sans plus personne pour attendre son résultat.
 */
const NO_TIMEOUT: RequestOptions = { timeout: 0 };

/**
 * Implémente l'API IPC du renderer au-dessus des routes Noxus.
 *
 * Les appelants conservent l'API à méthodes de l'ancien pont `ipcRenderer` ;
 * seule la plomberie change. Les écouteurs `on*` gardent leur sémantique : un
 * seul abonné par événement, le dernier enregistré remplaçant le précédent.
 */
export function createIpcBridge(client: NoxusRequester): IpcRendererBridge {
    const get = <T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> =>
        client.request<T>({ method: "GET", path, body }, options);

    const post = <T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> =>
        client.request<T>({ method: "POST", path, body }, options);

    const subscriptions = new Map<string, RendererEventSubscription>();

    const listen = <T>(event: string, callback: (payload: T) => void): void => {
        subscriptions.get(event)?.unsubscribe();
        subscriptions.set(event, client.events.subscribe<T>(event, callback));
    };

    return {
        // Fenêtre
        requestReload: () => post("window/reload"),
        close: () => post("window/close"),
        reduce: () => post("window/minimize"),
        toggleMaximize: () => post("window/toggle-maximize"),
        toggleFullscreen: () => post("window/toggle-fullscreen"),
        getTitlebarState: () => get("window/titlebar-state"),
        newWindow: () => post("window/new"),
        quitApp: () => post("window/quit"),
        getFilePathFromDrop: file => window.quark.getPathForFile(file),
        loadApp: () => get("window/load"),
        getWindowState: () => get("window/state"),
        openFileDialog: () => get("window/open-file-dialog", undefined, NO_TIMEOUT),

        // Base de données
        openFile: filePath => post("db/open-file", { filePath }, NO_TIMEOUT),
        submitPassword: password => post("db/submit-password", { password }, NO_TIMEOUT),
        closeFile: () => post("db/close"),
        refreshDatabase: () => post("db/refresh", undefined, NO_TIMEOUT),
        setDriverType: type => post("db/set-driver-type", { type }),
        connectNetwork: body => post("db/connect-network", body, NO_TIMEOUT),
        getSchema: () => get("db/schema", undefined, NO_TIMEOUT),
        getRecentDatabases: () => get("db/recent"),
        getAllDriverInfos: () => get("db/driver-infos"),

        getTableData: body => get("db/table-data", body, NO_TIMEOUT),
        getRow: body => get("db/row", body),
        updateCell: body => post("db/update-cell", body),
        batchUpdate: body => post("db/batch-update", body, NO_TIMEOUT),
        insertRow: body => post("db/insert-row", body),
        deleteRows: body => post("db/delete-rows", body, NO_TIMEOUT),
        transactionAction: action => post("db/transaction", { action }),

        execSql: body => post("db/exec-sql", body, NO_TIMEOUT),
        fetchSqlRows: body => get("db/sql-rows", body),
        getTablesSql: () => get("db/tables-sql"),

        exportData: body => get("db/export", body, NO_TIMEOUT),
        previewImport: body => get("db/preview-import", body, NO_TIMEOUT),
        importData: body => post("db/import", body, NO_TIMEOUT),

        getIndexes: table => get("db/indexes", { table }),
        createIndex: body => post("db/create-index", body, NO_TIMEOUT),
        dropIndex: name => post("db/drop-index", { name }),
        createTable: body => post("db/create-table", body),
        alterTable: action => post("db/alter-table", action, NO_TIMEOUT),
        dropTable: table => post("db/drop-table", { table }),
        changePassword: body => post("db/change-password", body, NO_TIMEOUT),

        // Coffre de connexions
        connVaultStatus: () => get("connections/status"),
        connInitialize: masterPassword => post("connections/initialize", { masterPassword }),
        connUnlock: masterPassword => post("connections/unlock", { masterPassword }),
        connLock: () => post("connections/lock"),
        connList: () => get("connections/list"),
        connCreate: input => post("connections/create", { input }),
        connUpdate: (id, input) => post("connections/update", { id, input }),
        connDelete: id => post("connections/delete", { id }),
        connConnect: id => post("connections/connect", { id }, NO_TIMEOUT),
        connExport: (ids, passphrase) => post("connections/export", { ids, passphrase }, NO_TIMEOUT),
        connImport: passphrase => post("connections/import", { passphrase }, NO_TIMEOUT),

        // Événements poussés par le main
        onNavigationRequested: callback => listen("navigate-to", callback),
        onFileOpened: callback => listen("open-file", callback),
        onTitleChanged: callback => listen("title-changed", callback),
        whenDisplayErrorDialog: callback => listen("display-error-dialog", callback),
        onUpdateAvailable: callback => listen("update-available", callback),
        onUpdateProgress: callback => listen("update-progress", callback),
        onSessionDiffChanged: callback => listen("session-diff-changed", callback),
    };
}
