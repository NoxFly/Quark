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
import {
    buildNetworkTarget,
    buildRemoteSqliteTarget,
    describeConnectionError,
    errorChainMessage,
    parseMongoUri,
    toTimeoutMs,
    withDeadline,
} from "src/core/drivers/connection-target.helper";
import type { NetworkConnectionRequest } from "src/core/drivers/connection-target.types";

const base: NetworkConnectionRequest = {
    driverType: "postgresql",
    host: "db.local",
    port: 5432,
    username: "admin",
    password: "p@ss:word",
    database: "shop",
};

describe("toTimeoutMs", () => {
    it("converts seconds and ignores unusable values", () => {
        expect(toTimeoutMs(15)).toBe(15_000);
        expect(toTimeoutMs(0.5)).toBe(500);
        expect(toTimeoutMs(undefined)).toBeUndefined();
        expect(toTimeoutMs(0)).toBeUndefined();
        expect(toTimeoutMs(-3)).toBeUndefined();
        expect(toTimeoutMs(Number.NaN)).toBeUndefined();
        expect(toTimeoutMs(1e9)).toBe(600_000);
    });
});

describe("buildNetworkTarget", () => {
    it("builds the driver URI and carries SSL and timeout options", () => {
        const target = buildNetworkTarget({ ...base, ssl: true, timeoutSeconds: 5 });

        expect(target).toEqual({
            driverType: "postgresql",
            location: "admin:p@ss:word@db.local:5432/shop",
            options: { ssl: true, timeoutSeconds: 5 },
        });
    });

    it("uses a placeholder user and passes the Azure authentication for a service principal", () => {
        const target = buildNetworkTarget({
            ...base,
            driverType: "azure",
            authMode: "service-principal",
            clientId: "client",
            tenantId: "tenant",
        });

        expect(target.location.startsWith("aad:")).toBe(true);
        expect(target.options.azureAuth).toEqual({ mode: "service-principal", clientId: "client", tenantId: "tenant" });
    });

    it("prefers a MongoDB URI and keeps its credentials out of the location", () => {
        const target = buildNetworkTarget({
            ...base,
            driverType: "mongodb",
            database: "",
            uri: " mongodb+srv://user:secret@cluster.example.net/sales?retryWrites=true ",
        });

        expect(target.location).toBe("cluster.example.net/sales");
        expect(target.location).not.toContain("secret");
        expect(target.options.uri).toBe("mongodb+srv://user:secret@cluster.example.net/sales?retryWrites=true");
    });

    it("lets the form database override the one of the URI, and falls back to the driver default", () => {
        const explicit = buildNetworkTarget({ ...base, driverType: "mongodb", database: "other", uri: "mongodb://h:1/sales" });
        const fallback = buildNetworkTarget({ ...base, driverType: "mongodb", database: "", uri: "mongodb://h1:1,h2:2" });

        expect(explicit.location).toBe("h:1/other");
        expect(fallback.location).toBe("h1:1,h2:2/test");
    });

    it("ignores the URI of a non MongoDB driver and rejects an invalid MongoDB URI", () => {
        expect(buildNetworkTarget({ ...base, uri: "mongodb://h/db" }).options.uri).toBeUndefined();
        expect(() => buildNetworkTarget({ ...base, driverType: "mongodb", uri: "http://nope" })).toThrow("MongoDB");
    });
});

describe("parseMongoUri", () => {
    it("extracts hosts and database", () => {
        expect(parseMongoUri("mongodb://u:p@a:1,b:2/my%20db?x=1")).toEqual({ hosts: "a:1,b:2", database: "my db" });
        expect(parseMongoUri("mongodb://a:1/")).toEqual({ hosts: "a:1", database: null });
        expect(parseMongoUri("postgres://a/b")).toBeNull();
    });
});

describe("buildRemoteSqliteTarget", () => {
    it("validates the scheme and trims the token", () => {
        const target = buildRemoteSqliteTarget({ url: " libsql://db-org.turso.io ", authToken: "  tok  ", timeoutSeconds: 3 });

        expect(target).toEqual({
            driverType: "libsql",
            location: "libsql://db-org.turso.io",
            options: { authToken: "tok", timeoutSeconds: 3 },
        });
        expect(buildRemoteSqliteTarget({ url: "https://db.example.io", authToken: " " }).options.authToken).toBeUndefined();
    });

    it("moves a token found in the URL out of the location", () => {
        const target = buildRemoteSqliteTarget({ url: "libsql://db.example.io?authToken=secret&tls=1" });

        expect(target.location).toBe("libsql://db.example.io?tls=1");
        expect(target.options.authToken).toBe("secret");
    });

    it("rejects local files and malformed URLs", () => {
        expect(() => buildRemoteSqliteTarget({ url: "file:local.db" })).toThrow("Unsupported");
        expect(() => buildRemoteSqliteTarget({ url: "not a url" })).toThrow("Invalid");
    });
});

describe("withDeadline", () => {
    it("resolves in time and rejects past the deadline", async () => {
        await expect(withDeadline(Promise.resolve(1), 50, "late")).resolves.toBe(1);
        await expect(withDeadline(new Promise(() => undefined), 10, "late")).rejects.toThrow("late");
    });
});

describe("describeConnectionError", () => {
    it("strips stacked prefixes and explains common network errors", () => {
        const message = describeConnectionError(new Error("Failed to connect to mysql: Error: connect ECONNREFUSED 127.0.0.1:3306"));

        expect(message).toBe("Connection refused: no server is listening at this address and port. (connect ECONNREFUSED 127.0.0.1:3306)");
        expect(describeConnectionError(new Error("getaddrinfo ENOTFOUND nowhere"))).toContain("Host not found");
        expect(describeConnectionError(new Error("password authentication failed for user \"x\""))).toContain("Authentication failed");
    });

    it("looks into the cause of a failed fetch", () => {
        const error = new Error("fetch failed", { cause: new Error("connect ECONNREFUSED 127.0.0.1:1") });

        expect(describeConnectionError(error)).toContain("Connection refused");
        expect(errorChainMessage(error)).toBe("fetch failed: connect ECONNREFUSED 127.0.0.1:1");
    });

    it("keeps an unknown message as is", () => {
        expect(describeConnectionError("Database \"x\" does not exist")).toBe("Database \"x\" does not exist");
    });
});
