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

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SystemKeychain } from "src/core/services/system-keychain.types";

const userData = mkdtempSync(join(tmpdir(), "quark-passwords-"));

vi.mock("electron/main", () => ({
    app: { getPath: () => userData },
    safeStorage: {},
}));

// L'entrée « main » de Noxus charge tout Electron : seul son Logger sert ici.
vi.mock("@noxfly/noxus/main", () => ({
    Logger: { info: vi.fn(), warn: vi.fn() },
}));

const { RememberedPasswords } = await import("src/core/services/remembered-passwords");

/** Trousseau factice : réversible, mais jamais le texte clair tel quel. */
function createKeychain(): SystemKeychain & { available: boolean } {
    return {
        available: true,
        isAvailable(): boolean {
            return this.available;
        },
        encrypt: plaintext => Buffer.from([...Buffer.from(plaintext, "utf8")].map(byte => byte ^ 0x5a)),
        decrypt: ciphertext => {
            if (ciphertext.length === 0) {
                throw new Error("undecryptable");
            }

            return Buffer.from([...ciphertext].map(byte => byte ^ 0x5a)).toString("utf8");
        },
    };
}

describe("RememberedPasswords", () => {
    let keychain: ReturnType<typeof createKeychain>;
    let passwords: InstanceType<typeof RememberedPasswords>;
    const file = join(userData, "remembered-passwords.json");

    beforeEach(() => {
        rmSync(file, { force: true });
        keychain = createKeychain();
        passwords = new RememberedPasswords(keychain, () => userData);
    });

    afterEach(() => {
        rmSync(file, { force: true });
    });

    it("stores passwords encrypted by the keychain, never in clear", () => {
        expect(passwords.remember("C:/data/app.db", "s3cret-pass")).toBe(true);

        expect(readFileSync(file, "utf8")).not.toContain("s3cret-pass");
        expect(new RememberedPasswords(keychain, () => userData).get("C:/data/app.db")).toBe("s3cret-pass");
    });

    it("forgets a password, and replaces one remembered again", () => {
        passwords.remember("a.db", "one");
        passwords.remember("a.db", "two");
        expect(passwords.get("a.db")).toBe("two");

        passwords.forget("a.db");
        expect(passwords.has("a.db")).toBe(false);
        expect(passwords.get("a.db")).toBeNull();
    });

    it("keys files by normalized path", () => {
        passwords.remember("data/./app.db", "pw");

        expect(passwords.get("data/app.db")).toBe("pw");
    });

    it("does nothing without a usable keychain", () => {
        keychain.available = false;

        expect(passwords.remember("a.db", "pw")).toBe(false);
        expect(passwords.get("a.db")).toBeNull();
    });

    it("forgets an entry the keychain can no longer decrypt", () => {
        passwords.remember("a.db", "pw");
        keychain.decrypt = () => {
            throw new Error("profile changed");
        };

        expect(passwords.get("a.db")).toBeNull();
        expect(passwords.has("a.db")).toBe(false);
    });

    it("survives a corrupted file", () => {
        passwords.remember("a.db", "pw");
        writeFileSync(file, "{ not json");

        const reloaded = new RememberedPasswords(keychain, () => userData);
        expect(reloaded.get("a.db")).toBeNull();
        expect(reloaded.remember("b.db", "pw")).toBe(true);
    });
});
