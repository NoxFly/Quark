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
import { decryptFromXml, encryptToXml } from "src/core/services/connection-crypto";

describe("connection-crypto", () => {
    it("round-trips a payload", async () => {
        const xml = await encryptToXml("<profiles>secret</profiles>", "passphrase");

        expect(xml).not.toContain("secret");
        expect(await decryptFromXml(xml, "passphrase")).toBe("<profiles>secret</profiles>");
    });

    it("uses a fresh salt and IV for every encryption", async () => {
        const first = await encryptToXml("same", "passphrase");
        const second = await encryptToXml("same", "passphrase");

        expect(first).not.toBe(second);
    });

    it("rejects a wrong passphrase", async () => {
        const xml = await encryptToXml("payload", "right");

        await expect(decryptFromXml(xml, "wrong")).rejects.toThrow();
    });

    it("rejects a tampered envelope", async () => {
        const xml = await encryptToXml("payload", "right");
        const tampered = xml.replace(/<data>(.)/, (_match, first: string) => `<data>${first === "A" ? "B" : "A"}`);

        await expect(decryptFromXml(tampered, "right")).rejects.toThrow();
    });

    it("rejects a malformed document", async () => {
        await expect(decryptFromXml("<nothing/>", "right")).rejects.toThrow("Invalid vault envelope");
    });
});
