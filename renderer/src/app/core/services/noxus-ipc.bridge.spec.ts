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

import type { RendererEventRegistry } from "@noxfly/noxus/renderer";
import { describe, expect, it, vi } from "vitest";
import { createIpcBridge, type NoxusRequester } from "src/app/core/services/noxus-ipc.bridge";

interface RecordedRequest {
    method: string;
    path: string;
    body?: unknown;
    timeout?: number;
}

function createClient(): { client: NoxusRequester; requests: RecordedRequest[]; emit: (event: string, payload: unknown) => void } {
    const requests: RecordedRequest[] = [];
    const handlers = new Map<string, Set<(payload: unknown) => void>>();

    const events = {
        subscribe: (event: string, handler: (payload: unknown) => void) => {
            const set = handlers.get(event) ?? new Set();
            set.add(handler);
            handlers.set(event, set);
            return { unsubscribe: () => set.delete(handler) };
        },
    } as unknown as RendererEventRegistry;

    const client: NoxusRequester = {
        events,
        request: async (request, options) => {
            requests.push({ ...request, timeout: options?.timeout });
            return undefined as never;
        },
    };

    const emit = (event: string, payload: unknown): void => {
        for (const handler of handlers.get(event) ?? []) {
            handler(payload);
        }
    };

    return { client, requests, emit };
}

describe("createIpcBridge", () => {
    it("maps reads to GET and mutations to POST", async () => {
        const { client, requests } = createClient();
        const ipc = createIpcBridge(client);

        await ipc.getTableData({ table: "people", offset: 0, limit: 50 });
        await ipc.updateCell({ table: "people", rowid: 1, column: "name", value: "x" });

        expect(requests.map(r => `${r.method} ${r.path}`)).toEqual(["GET db/table-data", "POST db/update-cell"]);
    });

    it("wraps primitive arguments in a body object", async () => {
        const { client, requests } = createClient();
        const ipc = createIpcBridge(client);

        await ipc.openFile("C:/data/app.db");
        await ipc.dropTable("people");
        await ipc.transactionAction("commit");
        await ipc.connUpdate("id-1", { name: "n", driverType: "sqlite", connectionType: "file" });

        expect(requests.map(r => r.body)).toEqual([
            { filePath: "C:/data/app.db" },
            { table: "people" },
            { action: "commit" },
            { id: "id-1", input: { name: "n", driverType: "sqlite", connectionType: "file" } },
        ]);
    });

    it("maps the connection, vault and table maintenance routes", async () => {
        const { client, requests } = createClient();
        const ipc = createIpcBridge(client);

        await ipc.submitPassword("pw", true);
        await ipc.connectRemoteSqlite({ url: "libsql://db.example.io", authToken: "t" });
        await ipc.testConnection({ kind: "file", filePath: "C:/data/app.db" });
        await ipc.truncateTable("people");
        await ipc.connFolders();
        await ipc.connFolderCreate({ name: "Prod" });
        await ipc.connFolderUpdate("f-1", { name: "Staging" });
        await ipc.connFolderDelete("f-1");
        await ipc.connSetMasterPassword({ enabled: false, masterPassword: "master" });

        expect(requests.map(r => `${r.method} ${r.path}`)).toEqual([
            "POST db/submit-password",
            "POST db/connect-remote-sqlite",
            "POST db/test-connection",
            "POST db/truncate-table",
            "GET connections/folders",
            "POST connections/folder-create",
            "POST connections/folder-update",
            "POST connections/folder-delete",
            "POST connections/master-password",
        ]);
        expect(requests.map(r => r.body)).toEqual([
            { password: "pw", remember: true },
            { url: "libsql://db.example.io", authToken: "t" },
            { kind: "file", filePath: "C:/data/app.db" },
            { table: "people" },
            undefined,
            { input: { name: "Prod" } },
            { id: "f-1", input: { name: "Staging" } },
            { id: "f-1" },
            { enabled: false, masterPassword: "master" },
        ]);
        expect(requests[2]?.timeout).toBe(0);
    });

    it("disables the timeout of operations whose duration depends on the database", async () => {
        const { client, requests } = createClient();
        const ipc = createIpcBridge(client);

        await ipc.execSql({ sql: "SELECT 1" });
        await ipc.getTitlebarState();

        expect(requests[0]?.timeout).toBe(0);
        expect(requests[1]?.timeout).toBeUndefined();
    });

    it("keeps a single listener per event, the last one registered", () => {
        const { client, emit } = createClient();
        const ipc = createIpcBridge(client);
        const first = vi.fn();
        const second = vi.fn();

        ipc.onTitleChanged(first);
        ipc.onTitleChanged(second);
        emit("title-changed", "db.sqlite");

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledWith("db.sqlite");
    });
});
