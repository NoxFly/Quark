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
import { retainTabs } from "src/app/shared/helpers/tabs.helper";

const tabs = ["a", "b", "c", "d"];

describe("retainTabs", () => {
    it("garde l'onglet actif conservé, à son nouvel index", () => {
        expect(retainTabs(tabs, 2, tab => tab !== "a")).toEqual({ tabs: ["b", "c", "d"], activeIndex: 1 });
    });

    it("active le voisin suivant quand l'actif disparaît", () => {
        expect(retainTabs(tabs, 1, tab => tab !== "b")).toEqual({ tabs: ["a", "c", "d"], activeIndex: 1 });
    });

    it("active le dernier restant quand l'actif et ceux qui suivent disparaissent", () => {
        expect(retainTabs(tabs, 2, tab => tab === "a" || tab === "b")).toEqual({ tabs: ["a", "b"], activeIndex: 1 });
    });

    it("n'active rien quand aucun onglet ne reste", () => {
        expect(retainTabs(tabs, 0, () => false)).toEqual({ tabs: [], activeIndex: -1 });
    });

    it("n'active rien quand aucun onglet n'était actif", () => {
        expect(retainTabs(tabs, -1, tab => tab !== "c")).toEqual({ tabs: ["a", "b", "d"], activeIndex: -1 });
    });
});
