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
import type { FieldDef, TableSchema } from "@shared/types";
import {
    clampZoom,
    computeErLinks,
    ER_BOX_WIDTH,
    ER_HEADER_HEIGHT,
    ER_MAX_ZOOM,
    ER_MIN_ZOOM,
    ER_ROW_HEIGHT,
    erTableHeight,
    layoutErNodes,
    zoomViewAt,
} from "src/app/shared/helpers/er-diagram.helper";

function field(name: string, fk: FieldDef["fk"] = null): FieldDef {
    return { name, type: "INTEGER", notnull: false, dflt_value: null, pk: name === "id", fk };
}

function table(name: string, fields: FieldDef[]): TableSchema {
    return { name, fields, weight: 0, recordCount: 0 };
}

describe("clampZoom", () => {
    it("keeps the zoom within its bounds", () => {
        expect(clampZoom(0.1)).toBe(ER_MIN_ZOOM);
        expect(clampZoom(10)).toBe(ER_MAX_ZOOM);
        expect(clampZoom(1.5)).toBe(1.5);
    });
});

describe("zoomViewAt", () => {
    it("keeps the point under the pointer fixed", () => {
        const view = { x: 20, y: 10, k: 1 };
        const next = zoomViewAt(view, 2, 120, 60);
        // Point du plan sous le pointeur, avant et après.
        const before = { x: (120 - view.x) / view.k, y: (60 - view.y) / view.k };
        const after = { x: (120 - next.x) / next.k, y: (60 - next.y) / next.k };

        expect(next.k).toBe(2);
        expect(after.x).toBeCloseTo(before.x);
        expect(after.y).toBeCloseTo(before.y);
    });

    it("does not move the view once the zoom bound is reached", () => {
        const view = { x: 5, y: 7, k: ER_MAX_ZOOM };

        expect(zoomViewAt(view, 1.1, 300, 200)).toEqual(view);
    });

    it("zooms out down to the minimum", () => {
        expect(zoomViewAt({ x: 0, y: 0, k: 0.35 }, 0.5, 0, 0).k).toBe(ER_MIN_ZOOM);
    });
});

describe("layoutErNodes", () => {
    it("returns nothing for an empty schema", () => {
        expect(layoutErNodes([])).toEqual([]);
    });

    it("sizes every box from its columns", () => {
        const users = table("users", [field("id"), field("name"), field("email")]);
        const [node] = layoutErNodes([users]);

        expect(node?.width).toBe(ER_BOX_WIDTH);
        expect(node?.height).toBe(erTableHeight(users));
        expect(erTableHeight(users)).toBe(ER_HEADER_HEIGHT + 3 * ER_ROW_HEIGHT);
    });

    it("lays tables out on a grid without overlap", () => {
        const tables = Array.from({ length: 7 }, (_, i) => table(`t${i}`, [field("id"), field("value")]));
        const nodes = layoutErNodes(tables);

        expect(nodes).toHaveLength(7);

        for (const [i, a] of nodes.entries()) {
            for (const b of nodes.slice(i + 1)) {
                const overlaps = a.x < b.x + b.width && b.x < a.x + a.width
                    && a.y < b.y + b.height && b.y < a.y + a.height;

                expect(overlaps).toBe(false);
            }
        }

        // Plus d'une colonne : le placement vise un format paysage.
        expect(new Set(nodes.map(node => node.x)).size).toBeGreaterThan(1);
    });
});

describe("computeErLinks", () => {
    const users = table("users", [field("id"), field("name")]);
    const orders = table("orders", [field("id"), field("user_id", { table: "users", column: "id" })]);

    it("links a foreign key to the referenced column", () => {
        const nodes = [
            { table: users, x: 0, y: 0, width: ER_BOX_WIDTH, height: erTableHeight(users) },
            { table: orders, x: 400, y: 100, width: ER_BOX_WIDTH, height: erTableHeight(orders) },
        ];

        const [link] = computeErLinks(nodes);

        expect(link).toMatchObject({ fromTable: "orders", fromColumn: "user_id", toTable: "users", toColumn: "id" });
        // orders est à droite de users : le lien part de son bord gauche vers le bord droit de users.
        const fromY = 100 + ER_HEADER_HEIGHT + ER_ROW_HEIGHT + ER_ROW_HEIGHT / 2;
        const toY = ER_HEADER_HEIGHT + ER_ROW_HEIGHT / 2;
        expect(link?.path).toBe(`M 400 ${fromY} C 310 ${fromY}, 310 ${toY}, ${ER_BOX_WIDTH} ${toY}`);
    });

    it("targets the header when the referenced column is unknown, and ignores missing tables", () => {
        const invoices = table("invoices", [
            field("user_id", { table: "users", column: "uid" }),
            field("shop_id", { table: "shops", column: "id" }),
        ]);
        const nodes = [
            { table: invoices, x: 0, y: 0, width: ER_BOX_WIDTH, height: erTableHeight(invoices) },
            { table: users, x: 400, y: 0, width: ER_BOX_WIDTH, height: erTableHeight(users) },
        ];

        const links = computeErLinks(nodes);

        expect(links).toHaveLength(1);
        expect(links[0]?.path.endsWith(`400 ${ER_HEADER_HEIGHT / 2}`)).toBe(true);
    });
});
