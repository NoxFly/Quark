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

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const userData = mkdtempSync(join(tmpdir(), "quark-vault-"));

vi.mock("electron/main", () => ({
    app: { getPath: () => userData },
}));

const { ConnectionStore } = await import("src/core/services/connection-store");

describe("ConnectionStore", () => {
    let store: InstanceType<typeof ConnectionStore>;

    beforeEach(() => {
        rmSync(join(userData, "connections.xml"), { force: true });
        store = new ConnectionStore();
    });

    afterEach(() => {
        store.lock();
    });

    it("stores profiles encrypted and never exposes their secret", async () => {
        await store.initialize("master");
        const created = await store.create({
            name: "prod",
            driverType: "postgresql",
            connectionType: "network",
            host: "db.local",
            port: 5432,
            username: "admin",
            password: "s3cret",
        });

        expect(created.hasPassword).toBe(true);
        expect(created).not.toHaveProperty("password");
        expect(readFileSync(join(userData, "connections.xml"), "utf8")).not.toContain("s3cret");
    });

    it("unlocks only with the master password", async () => {
        await store.initialize("master");
        await store.create({ name: "local", driverType: "sqlite", connectionType: "file", filePath: "a.db" });
        store.lock();

        expect(await store.unlock("wrong")).toBe(false);
        expect(() => store.list()).toThrow("locked");

        expect(await store.unlock("master")).toBe(true);
        expect(store.list().map(profile => profile.name)).toEqual(["local"]);
    });

    it("persists every change, even when changes overlap", async () => {
        await store.initialize("master");

        await Promise.all([
            store.create({ name: "one", driverType: "sqlite", connectionType: "file" }),
            store.create({ name: "two", driverType: "sqlite", connectionType: "file" }),
        ]);

        const reopened = new ConnectionStore();
        await reopened.unlock("master");

        expect(reopened.list().map(profile => profile.name).sort()).toEqual(["one", "two"]);
    });

    it("exports with a passphrase and imports into another vault", async () => {
        await store.initialize("master");
        const profile = await store.create({ name: "shared", driverType: "mysql", connectionType: "network", password: "pw" });
        const exported = await store.exportProfiles([profile.id], "share-key");

        await expect(store.importProfiles(exported, "bad-key")).rejects.toThrow();
        expect(await store.importProfiles(exported, "share-key")).toBe(1);

        const imported = store.list().filter(p => p.name === "shared");
        expect(imported).toHaveLength(2);
        expect(new Set(imported.map(p => p.id)).size).toBe(2);
    });
});
