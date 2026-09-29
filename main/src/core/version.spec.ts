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
import { Version } from "src/core/version";

const compare = (a: string, b: string): number => Math.sign(new Version(a).compareTo(new Version(b)));

describe("Version", () => {
    it("orders by major, minor then patch", () => {
        expect(compare("1.0.0", "0.9.9")).toBe(1);
        expect(compare("0.2.0", "0.10.0")).toBe(-1);
        expect(compare("0.1.2", "0.1.2")).toBe(0);
    });

    it("places the semantic versions published by the CI above the former build numbers", () => {
        // Les releases passent de `0.0.1+build.<run>` à une version sémantique
        // déduite des commits : une installation existante doit se voir proposer
        // la mise à jour.
        expect(compare("0.1.0", "0.0.1+build.250")).toBe(1);
    });

    it("orders builds of the same version", () => {
        expect(compare("1.4.2+build.318", "1.4.2+build.317")).toBe(1);
    });

    it("places a pre-release before the stable release", () => {
        expect(compare("1.0.0-beta.7", "1.0.0")).toBe(-1);
    });

    it("rejects malformed versions", () => {
        expect(Version.parse("not a version")).toBeNull();
    });
});
