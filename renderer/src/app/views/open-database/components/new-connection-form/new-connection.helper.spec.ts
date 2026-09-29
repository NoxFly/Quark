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

import { describe, expect, it } from "vitest";
import type { DriverPresentation } from "src/app/core/models/driver-presentation.model";
import type { NewConnectionDraft } from "src/app/core/models/new-connection.model";
import { HOME_DRIVERS } from "src/app/shared/helpers/driver-presentation.helper";
import {
    buildNetworkBody,
    buildProfileInput,
    buildTestBody,
    createDraft,
    isDraftComplete,
    profileNameFor,
} from "src/app/views/open-database/components/new-connection-form/new-connection.helper";

function driver(type: string): DriverPresentation {
    const found = HOME_DRIVERS.find(candidate => candidate.type === type);

    if (!found) {
        throw new Error(`driver ${type} absent`);
    }

    return found;
}

function draft(patch: Partial<NewConnectionDraft>, defaultPort: number | null = null): NewConnectionDraft {
    return { ...createDraft(defaultPort, true), ...patch };
}

describe("new-connection.helper", () => {
    it("reprend le port par défaut et le réglage SSL", () => {
        const initial = createDraft(5432, false);
        expect(initial.port).toBe(5432);
        expect(initial.ssl).toBe(false);
        expect(initial.host).toBe("localhost");
    });

    it("exige la source SQLite selon le mode", () => {
        const sqlite = driver("sqlite");
        expect(isDraftComplete(sqlite, draft({ filePath: "C:\\a.db" }))).toBe(true);
        expect(isDraftComplete(sqlite, draft({ sqliteMode: "url", filePath: "C:\\a.db" }))).toBe(false);
        expect(isDraftComplete(sqlite, draft({ sqliteMode: "url", url: "libsql://x.turso.io" }))).toBe(true);
    });

    it("exige les identifiants du principal de service Azure", () => {
        const azure = driver("azure");
        const base = draft({ host: "srv", database: "erp", authMode: "service-principal" });
        expect(isDraftComplete(azure, base)).toBe(false);
        expect(isDraftComplete(azure, { ...base, clientId: "c", tenantId: "t", password: "s" })).toBe(true);
    });

    it("transmet SSL, délai et mode Azure pour un serveur", () => {
        const body = buildNetworkBody(driver("azure"), draft({ host: " srv ", database: "erp", port: 1433 }), 30);
        expect(body).toMatchObject({ driverType: "azure", host: "srv", port: 1433, ssl: true, timeoutSeconds: 30, authMode: "sql" });
        expect(body.clientId).toBeUndefined();
    });

    it("n'envoie que l'URI pour MongoDB", () => {
        const body = buildNetworkBody(driver("mongodb"), draft({ uri: "mongodb://h/db" }), 10);
        expect(body.uri).toBe("mongodb://h/db");
        expect(body.host).toBe("");
        expect(body.ssl).toBeUndefined();
    });

    it("choisit la cible du test", () => {
        const sqlite = driver("sqlite");
        expect(buildTestBody(sqlite, draft({ filePath: "C:\\a.db" }), 30)).toEqual({ kind: "file", filePath: "C:\\a.db" });
        const remote = buildTestBody(sqlite, draft({ sqliteMode: "url", url: "libsql://x", authToken: "" }), 30);
        expect(remote).toEqual({ kind: "remote-sqlite", url: "libsql://x", authToken: undefined, timeoutSeconds: 30 });
        expect(buildTestBody(driver("postgresql"), draft({ host: "h", database: "d" }), 30).kind).toBe("network");
    });

    it("propose un nom de profil lisible", () => {
        expect(profileNameFor(driver("sqlite"), draft({ filePath: "C:\\Données\\boutique.db" }))).toBe("boutique.db");
        expect(profileNameFor(driver("postgresql"), draft({ host: "pg", database: "inventaire" }))).toBe("inventaire (pg)");
        expect(profileNameFor(driver("mongodb"), draft({ uri: "mongodb://u:p@h:27017/logs" }))).toBe("logs");
    });

    it("range le jeton d'une base distante comme secret du profil", () => {
        const input = buildProfileInput(driver("sqlite"), draft({ sqliteMode: "url", url: "libsql://x.io/db", authToken: "tok" }));
        expect(input).toMatchObject({ driverType: "libsql", sqliteMode: "url", url: "libsql://x.io/db", password: "tok" });
    });
});
