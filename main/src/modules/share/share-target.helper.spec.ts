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
import type { StoredConnectionProfile } from "src/core/services/connection-store.types";

import { connectionSecrets, shareTarget } from "src/modules/share/share-target.helper";

const PROFILE: StoredConnectionProfile = {
    id: "p1",
    name: "prod",
    driverType: "postgresql",
    connectionType: "network",
    host: "db.example.com",
    port: 5432,
    username: "admin",
    database: "sales",
    password: "s3cret",
    createdAt: 0,
    updatedAt: 0,
};

describe("share target", () => {
    it("uses the profile credentials unless others are given for the share", () => {
        expect(shareTarget(PROFILE, {}).location).toContain("admin");

        const overridden = shareTarget(PROFILE, { username: "reader", secret: "ro-pass" });
        expect(overridden.location).toContain("reader");
        expect(overridden.location).not.toContain("s3cret");
    });

    it("refuses a local SQLite file", () => {
        expect(() => shareTarget({ ...PROFILE, driverType: "sqlite", connectionType: "file", filePath: "a.db" }, {})).toThrow();
    });
});

describe("connection secrets", () => {
    it("lists every piece of the address that must not reach the recipient", () => {
        const secrets = connectionSecrets(shareTarget(PROFILE, {}));

        expect(secrets).toEqual(expect.arrayContaining(["db.example.com", "admin", "s3cret", "sales"]));
    });

    it("covers each host of a MongoDB connection string", () => {
        const secrets = connectionSecrets({
            driverType: "mongodb",
            location: "",
            options: { uri: "mongodb://user:pw@rs1.example.com:27017,rs2.example.com:27017/logs" },
        });

        expect(secrets).toEqual(expect.arrayContaining(["rs1.example.com", "rs2.example.com", "user", "logs"]));
    });
});
