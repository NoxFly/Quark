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
import type { RecentDatabaseEntry } from "@shared/ipc-renderer";
import { isEncryptedFile } from "src/app/shared/helpers/database-encryption.helper";

function recent(overrides: Partial<RecentDatabaseEntry>): RecentDatabaseEntry {
    return {
        connectionType: "file",
        driverType: "sqlite",
        displayName: "shop.db",
        displaySubtitle: "C:\\data",
        lastOpened: 0,
        requiresPassword: false,
        filePath: "C:\\data\\shop.db",
        ...overrides,
    };
}

describe("isEncryptedFile", () => {
    it("reads the flag of the matching file", () => {
        const recents = [
            recent({ filePath: "a.db", requiresPassword: true }),
            recent({ filePath: "b.db", requiresPassword: false }),
        ];

        expect(isEncryptedFile(recents, "a.db")).toBe(true);
        expect(isEncryptedFile(recents, "b.db")).toBe(false);
    });

    it("returns null when the file is unknown or no file is open", () => {
        expect(isEncryptedFile([recent({ filePath: "a.db" })], "c.db")).toBeNull();
        expect(isEncryptedFile([recent({ filePath: "a.db" })], null)).toBeNull();
        expect(isEncryptedFile([], "a.db")).toBeNull();
    });

    it("ignores network connections, whose password is not a file cipher", () => {
        const recents = [recent({ connectionType: "network", filePath: "a.db", requiresPassword: true })];

        expect(isEncryptedFile(recents, "a.db")).toBeNull();
    });
});
