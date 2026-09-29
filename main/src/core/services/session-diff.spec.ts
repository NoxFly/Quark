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

import { beforeEach, describe, expect, it } from "vitest";
import { SessionDiff } from "src/core/services/session-diff";

describe("SessionDiff", () => {
    let diff: SessionDiff;

    beforeEach(() => {
        diff = new SessionDiff();
        diff.start("test.db");
    });

    it("merges successive edits of a row into one entry", () => {
        diff.recordUpdate("people", 1, { rowid: 1, name: "a" }, { rowid: 1, name: "b" });
        diff.recordUpdate("people", 1, { rowid: 1, name: "b" }, { rowid: 1, name: "c" });

        const [table] = diff.getSnapshot().tables;

        expect(table?.rows).toHaveLength(1);
        expect(table?.rows[0]?.before?.["name"]).toBe("a");
        expect(table?.rows[0]?.after?.["name"]).toBe("c");
        expect(table?.rows[0]?.changedColumns).toEqual(["name"]);
    });

    it("drops an edit that restores the original value", () => {
        diff.recordUpdate("people", 1, { rowid: 1, name: "a" }, { rowid: 1, name: "b" });
        diff.recordUpdate("people", 1, { rowid: 1, name: "b" }, { rowid: 1, name: "a" });

        expect(diff.getSummary().rows).toBe(0);
    });

    it("forgets a row inserted then deleted during the session", () => {
        diff.recordInsert("people", 7, { rowid: 7, name: "new" });
        diff.recordDelete("people", 7, { rowid: 7, name: "new" });

        expect(diff.getSummary().rows).toBe(0);
    });

    it("restores the journal on rollback", () => {
        diff.recordUpdate("people", 1, { rowid: 1, name: "a" }, { rowid: 1, name: "b" });

        diff.beginTransaction();
        diff.recordDelete("people", 2, { rowid: 2, name: "x" });
        diff.recordUpdate("people", 1, { rowid: 1, name: "b" }, { rowid: 1, name: "c" });
        diff.rollbackTransaction();

        const rows = diff.getSnapshot().tables.flatMap(table => table.rows);

        expect(rows).toHaveLength(1);
        expect(rows[0]?.after?.["name"]).toBe("b");
    });

    it("keeps the changes of a committed transaction", () => {
        diff.beginTransaction();
        diff.recordDelete("people", 2, { rowid: 2, name: "x" });
        diff.commitTransaction();

        expect(diff.getSnapshot().tables[0]?.deleted).toBe(1);
    });

    it("counts opaque operations separately", () => {
        diff.recordOpaque({ category: "sql", label: "SQL statement executed", detail: "DELETE FROM people" });

        expect(diff.getSummary()).toEqual({ tables: 0, rows: 0, opaque: 1 });
    });

    it("keeps tracking across a reopening of the same source only", () => {
        expect(diff.isTracking("test.db")).toBe(true);
        expect(diff.isTracking("other.db")).toBe(false);
    });
});
