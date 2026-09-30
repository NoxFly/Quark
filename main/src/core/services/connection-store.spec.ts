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

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptToXml } from "src/core/services/connection-crypto";
import type { SystemKeychain } from "src/core/services/system-keychain.types";

const userData = mkdtempSync(join(tmpdir(), "quark-vault-"));

vi.mock("electron/main", () => ({
    app: { getPath: () => userData },
}));

const { ConnectionStore } = await import("src/core/services/connection-store");

const vaultFile = join(userData, "connections.xml");
const keyFile = join(userData, "connections.key");

/** Trousseau factice : réversible, jamais le texte clair tel quel. */
function createKeychain(): SystemKeychain & { available: boolean } {
    return {
        available: true,
        isAvailable(): boolean {
            return this.available;
        },
        encrypt: plaintext => Buffer.from(plaintext, "utf8").reverse(),
        decrypt: ciphertext => Buffer.from(ciphertext).reverse().toString("utf8"),
    };
}

describe("ConnectionStore", () => {
    let store: InstanceType<typeof ConnectionStore>;
    let keychain: ReturnType<typeof createKeychain>;

    beforeEach(() => {
        rmSync(vaultFile, { force: true });
        rmSync(keyFile, { force: true });
        keychain = createKeychain();
        store = new ConnectionStore(keychain);
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

    it("reads a vault written before folders existed without losing anything", async () => {
        // Contenu d'un coffre en version 1 : ni dossiers, ni nouveaux champs.
        const legacy = [
            "<connections version=\"1\">",
            "  <connection id=\"legacy-1\" name=\"old\" driverType=\"mysql\" connectionType=\"network\" host=\"h\"",
            "    port=\"3306\" username=\"u\" database=\"d\" password=\"pw\" createdAt=\"1\" updatedAt=\"2\"></connection>",
            "</connections>",
        ].join("\n");
        writeFileSync(vaultFile, await encryptToXml(legacy, "master"), "utf-8");

        expect(await store.unlock("master")).toBe(true);

        const [profile] = store.list();
        expect(profile).toMatchObject({ id: "legacy-1", name: "old", host: "h", port: 3306, hasPassword: true });
        expect(profile?.folderId).toBeUndefined();
        expect(profile?.lastConnectedAt).toBeUndefined();

        const folders = store.listFolders();
        expect(folders.map(folder => folder.name)).toEqual(["Connexions"]);

        // Le dossier par défaut est écrit aussitôt : son identifiant reste stable.
        const reopened = new ConnectionStore(keychain);
        await reopened.unlock("master");
        expect(reopened.listFolders()).toEqual(folders);
        expect(reopened.getProfile("legacy-1")?.password).toBe("pw");
    });

    it("persists the new profile fields and dates successful connections", async () => {
        await store.initialize("master");
        const [folder] = store.listFolders();
        const notes = "line 1\nline <2> & \"3\"";
        const remote = await store.create({
            name: "turso",
            driverType: "sqlite",
            connectionType: "file",
            sqliteMode: "url",
            url: " libsql://db.turso.io ",
            filePath: "ignored.db",
            password: "token",
            folderId: folder?.id,
            tag: "production",
            notes,
        });
        const mongo = await store.create({
            name: "atlas",
            driverType: "mongodb",
            connectionType: "network",
            uri: "mongodb+srv://u:p@cluster/db",
            ssl: false,
        });

        await store.markConnected(remote.id);
        const connectedAt = store.getProfile(remote.id)?.lastConnectedAt;
        await store.update(remote.id, { ...remote, name: "turso prod" });

        const reopened = new ConnectionStore(keychain);
        await reopened.unlock("master");
        const reread = reopened.list();

        expect(reread.find(p => p.id === remote.id)).toMatchObject({
            name: "turso prod",
            sqliteMode: "url",
            url: "libsql://db.turso.io",
            folderId: folder?.id,
            tag: "production",
            notes,
            lastConnectedAt: connectedAt,
            hasPassword: true,
        });
        expect(reread.find(p => p.id === remote.id)?.filePath).toBeUndefined();
        expect(reread.find(p => p.id === mongo.id)).toMatchObject({ uri: "mongodb+srv://u:p@cluster/db", ssl: false });
        expect(connectedAt).toBeTypeOf("number");
    });

    it("gives the application tags to a vault written before custom tags", async () => {
        const legacy = [
            "<connections version=\"2\">",
            "  <folder id=\"f1\" name=\"Clients\" order=\"0\"></folder>",
            "  <connection id=\"p1\" name=\"prod\" driverType=\"mysql\" connectionType=\"network\" tag=\"production\"",
            "    folderId=\"f1\" createdAt=\"1\" updatedAt=\"2\"></connection>",
            "</connections>",
        ].join("\n");
        writeFileSync(vaultFile, await encryptToXml(legacy, "master"), "utf-8");

        expect(await store.unlock("master")).toBe(true);
        expect(store.listTags().map(tag => tag.id)).toEqual(["production", "client", "local", "other"]);
        expect(store.list()[0]?.tag).toBe("production");

        // Les étiquettes sont écrites aussitôt : toutes supprimées, elles ne reviennent pas.
        for (const tag of store.listTags()) {
            await store.deleteTag(tag.id);
        }

        const reopened = new ConnectionStore(keychain);
        await reopened.unlock("master");
        expect(reopened.listTags()).toEqual([]);
        expect(reopened.list()[0]?.tag).toBeUndefined();
    });

    it("creates, recolors and deletes tags, and keeps only known tags on profiles", async () => {
        await store.initialize("master");

        const custom = await store.createTag({ name: " Recette ", color: "#8E4EC6" });
        expect(custom).toMatchObject({ name: "Recette", color: "#8e4ec6" });

        await expect(store.createTag({ name: " " })).rejects.toThrow();
        await expect(store.updateTag(custom.id, { color: "red" })).rejects.toThrow();
        await expect(store.updateTag(custom.id, { name: "" })).rejects.toThrow();

        // Une étiquette fournie retrouve son nom traduit et sa couleur de thème.
        await store.updateTag("local", { name: "Poste", color: "#46a758" });
        expect(await store.updateTag("local", { name: "", color: "" })).toEqual({ id: "local", order: 2 });

        const tagged = await store.create({ name: "a", driverType: "mysql", connectionType: "network", tag: custom.id });
        const unknown = await store.create({ name: "b", driverType: "mysql", connectionType: "network", tag: "nope" });
        expect(tagged.tag).toBe(custom.id);
        expect(unknown.tag).toBeUndefined();

        await store.deleteTag(custom.id);
        expect(store.getProfile(tagged.id)?.tag).toBeUndefined();
    });

    it("moves a profile to a position, in its folder or another one", async () => {
        await store.initialize("master");
        const [first] = store.listFolders();
        const other = await store.createFolder({ name: "Autre" });

        const a = await store.create({ name: "a", driverType: "mysql", connectionType: "network", folderId: first!.id });
        const b = await store.create({ name: "b", driverType: "mysql", connectionType: "network", folderId: first!.id });
        const c = await store.create({ name: "c", driverType: "mysql", connectionType: "network", folderId: other.id });

        const inFolder = (folderId: string): string[] => store.list()
            .filter(profile => profile.folderId === folderId)
            .sort((x, y) => (x.order ?? 0) - (y.order ?? 0))
            .map(profile => profile.name);

        await store.moveProfile(b.id, first!.id, 0);
        expect(inFolder(first!.id)).toEqual(["b", "a"]);

        await store.moveProfile(c.id, first!.id, 1);
        expect(inFolder(first!.id)).toEqual(["b", "c", "a"]);
        expect(inFolder(other.id)).toEqual([]);

        await store.moveProfile(a.id, other.id, 99);
        expect(inFolder(other.id)).toEqual(["a"]);
        await expect(store.moveProfile(a.id, "missing", 0)).rejects.toThrow();
    });

    it("manages folders and moves the profiles of a deleted folder", async () => {
        await store.initialize("master");
        const [first] = store.listFolders();
        const second = await store.createFolder({ name: "  Clients  " });
        const profile = await store.create({ name: "p", driverType: "sqlite", connectionType: "file", folderId: second.id });

        expect(second).toMatchObject({ name: "Clients", order: 1 });
        expect((await store.updateFolder(second.id, { name: "Customers" })).name).toBe("Customers");
        await expect(store.createFolder({ name: " " })).rejects.toThrow("empty");

        await store.deleteFolder(second.id);

        expect(store.listFolders().map(folder => folder.id)).toEqual([first?.id]);
        expect(store.getProfile(profile.id)?.folderId).toBe(first?.id);
        await expect(store.deleteFolder(first?.id ?? "")).rejects.toThrow("last");
    });

    it("exports folders with their profiles and merges them by name on import", async () => {
        await store.initialize("master");
        const clients = await store.createFolder({ name: "Clients" });
        const shared = await store.create({
            name: "shared",
            driverType: "postgresql",
            connectionType: "network",
            ssl: true,
            folderId: clients.id,
            password: "pw",
        });
        await store.markConnected(shared.id);

        const exported = await store.exportProfiles([shared.id], "share-key");

        rmSync(vaultFile, { force: true });
        const other = new ConnectionStore(keychain);
        await other.initialize("other");
        expect(await other.importProfiles(exported, "share-key")).toBe(1);

        const imported = other.list()[0];
        const importedFolder = other.listFolders().find(folder => folder.id === imported?.folderId);

        expect(imported).toMatchObject({ name: "shared", ssl: true, hasPassword: true });
        expect(imported?.lastConnectedAt).toBeUndefined();
        expect(importedFolder?.name).toBe("Clients");

        // Un second import réutilise le dossier du même nom.
        await other.importProfiles(exported, "share-key");
        expect(other.listFolders().filter(folder => folder.name === "Clients")).toHaveLength(1);
    });

    it("unlocks through the system keychain once the master password is disabled", async () => {
        await store.initialize("master");
        await store.create({ name: "kept", driverType: "sqlite", connectionType: "file", password: "pw" });

        await expect(store.setMasterPassword({ enabled: false, masterPassword: "wrong" })).rejects.toThrow("Invalid");
        await store.setMasterPassword({ enabled: false, masterPassword: "master" });

        expect(existsSync(keyFile)).toBe(true);

        const nextSession = new ConnectionStore(keychain);
        expect(await nextSession.getStatus()).toEqual({ initialized: true, unlocked: true, masterPasswordEnabled: false });
        expect(nextSession.list().map(p => p.name)).toEqual(["kept"]);

        // Le coffre n'est plus chiffré par l'ancien mot de passe maître.
        rmSync(keyFile);
        expect(await new ConnectionStore(keychain).unlock("master")).toBe(false);
    });

    it("re-encrypts the vault with the new master password when it is enabled again", async () => {
        await store.initialize("master");
        await store.setMasterPassword({ enabled: false, masterPassword: "master" });
        await store.setMasterPassword({ enabled: true, masterPassword: "new-master" });

        expect(existsSync(keyFile)).toBe(false);

        const nextSession = new ConnectionStore(keychain);
        expect(await nextSession.getStatus()).toEqual({ initialized: true, unlocked: false, masterPasswordEnabled: true });
        expect(await nextSession.unlock("master")).toBe(false);
        expect(await nextSession.unlock("new-master")).toBe(true);
    });

    it("refuses to disable the master password without a system keychain", async () => {
        keychain.available = false;
        await store.initialize("master");

        await expect(store.setMasterPassword({ enabled: false, masterPassword: "master" })).rejects.toThrow("keychain");
        expect(existsSync(keyFile)).toBe(false);
    });

    it("can be created directly without a master password", async () => {
        await store.setMasterPassword({ enabled: false, masterPassword: "" });

        expect(await store.getStatus()).toEqual({ initialized: true, unlocked: true, masterPasswordEnabled: false });
        expect(store.listFolders()).toHaveLength(1);
    });

    it("drops a keychain secret that no longer opens the vault", async () => {
        await store.initialize("master");
        writeFileSync(keyFile, keychain.encrypt("stale-secret"));

        const nextSession = new ConnectionStore(keychain);

        expect(await nextSession.getStatus()).toEqual({ initialized: true, unlocked: false, masterPasswordEnabled: true });
        expect(existsSync(keyFile)).toBe(false);
        expect(await nextSession.unlock("master")).toBe(true);
    });
});
