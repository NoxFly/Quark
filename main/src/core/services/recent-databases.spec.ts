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

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const userData = mkdtempSync(join(tmpdir(), "quark-recents-"));

vi.mock("electron/main", () => ({
    app: { getPath: () => userData },
}));

const { RecentDatabases } = await import("src/core/services/recent-databases");

describe("RecentDatabases", () => {
    let recents: InstanceType<typeof RecentDatabases>;

    beforeEach(() => {
        recents = new RecentDatabases();
    });

    afterEach(() => {
        rmSync(userData, { recursive: true, force: true });
    });

    describe("addNetwork", () => {
        it("formate hôte, port et utilisateur pour une connexion classique", () => {
            recents.addNetwork({ driverType: "postgresql", host: "db.local", port: 5432, username: "app", database: "boutique" });

            const [entry] = recents.getAll();
            expect(entry).toMatchObject({
                displayName: "boutique",
                displaySubtitle: "app@db.local:5432",
                host: "db.local",
                port: 5432,
                username: "app",
                uri: undefined,
            });
        });

        // Régression : une connexion MongoDB n'a qu'une chaîne de connexion, jamais
        // d'hôte/port séparés — les enregistrer vides produisait « @:0 » et rendait
        // l'entrée impossible à rouvrir (host/port vides envoyés à la reconnexion).
        it("n'affiche pas « @:0 » pour une connexion MongoDB sans port fourni, et conserve l'URI", () => {
            recents.addNetwork({
                driverType: "mongodb",
                host: "localhost:27017",
                database: "riot",
                uri: "mongodb://localhost:27017/riot",
            });

            const [entry] = recents.getAll();
            expect(entry?.displaySubtitle).toBe("localhost:27017");
            expect(entry?.displaySubtitle).not.toContain("@");
            expect(entry?.displaySubtitle).not.toContain(":0");
            expect(entry?.uri).toBe("mongodb://localhost:27017/riot");
            expect(entry?.database).toBe("riot");
        });

        it("n'affiche pas d'arobase quand seul l'hôte est connu (pas d'utilisateur)", () => {
            recents.addNetwork({ driverType: "mongodb", host: "cluster0.mongodb.net", database: "test", uri: "mongodb+srv://cluster0.mongodb.net/test" });

            expect(recents.getAll()[0]?.displaySubtitle).toBe("cluster0.mongodb.net");
        });
    });

    describe("remove", () => {
        it("retire une entrée fichier identifiée par son chemin", () => {
            recents.addFile("C:\\data\\boutique.db", false);
            recents.addFile("C:\\data\\autre.db", false);

            recents.remove({
                connectionType: "file",
                driverType: "sqlite",
                displayName: "boutique.db",
                displaySubtitle: "C:\\data",
                lastOpened: Date.now(),
                requiresPassword: false,
                filePath: "C:\\data\\boutique.db",
            });

            const remaining = recents.getAll();
            expect(remaining).toHaveLength(1);
            expect(remaining[0]?.filePath).toBe("C:\\data\\autre.db");
        });

        it("ne fait rien si l'entrée n'existe pas (pas d'écriture disque inutile)", () => {
            recents.addFile("C:\\data\\boutique.db", false);

            recents.remove({
                connectionType: "file",
                driverType: "sqlite",
                displayName: "inconnu.db",
                displaySubtitle: "",
                lastOpened: Date.now(),
                requiresPassword: false,
                filePath: "C:\\data\\inconnu.db",
            });

            expect(recents.getAll()).toHaveLength(1);
        });
    });
});
