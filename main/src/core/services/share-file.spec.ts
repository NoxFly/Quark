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

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ConsumedShares } from "src/core/services/consumed-shares";
import { encryptToXml } from "src/core/services/connection-crypto";
import { fetchOnlineTime, OnlineClockUnavailableError } from "src/core/services/online-clock";
import {
    decryptShare,
    encryptShare,
    ShareInvalidFileError,
    type SharePayload,
    ShareWrongPasswordError,
} from "src/core/services/share-file";

vi.mock("electron/main", () => ({ app: { getPath: () => tmpdir() } }));

const PAYLOAD: SharePayload = {
    id: "share-1",
    name: "Prod client X",
    readOnly: true,
    singleUse: true,
    createdAt: 1_000,
    expiresAt: 2_000,
    target: {
        driverType: "postgresql",
        location: "admin:s3cret@db.example.com:5432/sales",
        options: { ssl: true },
    },
};

describe("share file", () => {
    it("round-trips a share with its restrictions and never stores it in clear", async () => {
        const content = await encryptShare(PAYLOAD, "123");

        expect(content).not.toContain("s3cret");
        expect(content).not.toContain("db.example.com");
        expect(await decryptShare(content, "123")).toEqual(PAYLOAD);
    });

    it("tells a wrong password apart from a file that is not a share", async () => {
        const content = await encryptShare(PAYLOAD, "123");

        await expect(decryptShare(content, "124")).rejects.toBeInstanceOf(ShareWrongPasswordError);
        await expect(decryptShare("not a share", "123")).rejects.toBeInstanceOf(ShareInvalidFileError);
        await expect(decryptShare(await encryptToXml("{\"format\":\"other\"}", "123"), "123"))
            .rejects.toBeInstanceOf(ShareInvalidFileError);
    });

    it("rejects a tampered file instead of reading altered restrictions", async () => {
        const content = await encryptShare(PAYLOAD, "123");
        const tampered = content.replace(/<data>(.)/, (_, first: string) => `<data>${first === "A" ? "B" : "A"}`);

        await expect(decryptShare(tampered, "123")).rejects.toBeInstanceOf(ShareWrongPasswordError);
    });

    it("refuses a password shorter than three characters", async () => {
        await expect(encryptShare(PAYLOAD, "12")).rejects.toThrow();
    });
});

describe("online clock", () => {
    it("reads the Date header of the first source that answers", async () => {
        const head = vi.fn()
            .mockRejectedValueOnce(new Error("offline"))
            .mockResolvedValueOnce({ headers: { get: () => "Wed, 30 Sep 2026 10:00:00 GMT" } });

        const now = await fetchOnlineTime(head);

        expect(head).toHaveBeenCalledTimes(2);
        expect(Math.abs(now - Date.UTC(2026, 8, 30, 10))).toBeLessThan(1_000);
    });

    it("fails when no source gives the time", async () => {
        const head = vi.fn().mockResolvedValue({ headers: { get: () => null } });

        await expect(fetchOnlineTime(head)).rejects.toBeInstanceOf(OnlineClockUnavailableError);
    });
});

describe("consumed shares", () => {
    it("remembers opened single-use shares across restarts, without their identifier", async () => {
        const directory = mkdtempSync(join(tmpdir(), "quark-shares-"));
        const registry = new ConsumedShares(directory);

        expect(registry.has("share-1")).toBe(false);
        await registry.add("share-1");

        const reopened = new ConsumedShares(directory);
        expect(reopened.has("share-1")).toBe(true);
        expect(reopened.has("share-2")).toBe(false);
    });
});
