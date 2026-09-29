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
import type { SqlHistoryEntry } from "src/app/core/models/sql-history.model";
import {
    compactQuery,
    formatExecutionTime,
    historyStorageKey,
    parseStoredHistory,
    pushHistoryEntry,
    SQL_HISTORY_LIMIT,
} from "src/app/shared/helpers/sql-history.helper";

function entry(query: string, overrides: Partial<SqlHistoryEntry> = {}): SqlHistoryEntry {
    return {
        query,
        executedAt: 1_000,
        status: "ok",
        isSelect: true,
        rows: 3,
        durationMs: 4,
        error: null,
        ...overrides,
    };
}

describe("pushHistoryEntry", () => {
    it("prepends the new entry without mutating the original", () => {
        const history = [entry("SELECT 1")];

        const next = pushHistoryEntry(history, entry("SELECT 2"));

        expect(next.map(e => e.query)).toEqual(["SELECT 2", "SELECT 1"]);
        expect(history).toHaveLength(1);
    });

    it("moves an already known query to the top instead of duplicating it", () => {
        const history = [entry("A"), entry("B"), entry("C")];

        const next = pushHistoryEntry(history, entry("C", { executedAt: 2_000 }));

        expect(next.map(e => e.query)).toEqual(["C", "A", "B"]);
        expect(next[0]?.executedAt).toBe(2_000);
    });

    it("caps the history to the default limit", () => {
        const history = Array.from({ length: SQL_HISTORY_LIMIT }, (_, i) => entry(`Q${i}`));

        const next = pushHistoryEntry(history, entry("NEW"));

        expect(next).toHaveLength(SQL_HISTORY_LIMIT);
        expect(next[0]?.query).toBe("NEW");
        expect(next.at(-1)?.query).toBe(`Q${SQL_HISTORY_LIMIT - 2}`);
    });

    it("honours a custom limit and never returns a negative slice", () => {
        expect(pushHistoryEntry([entry("A"), entry("B")], entry("C"), 2).map(e => e.query)).toEqual(["C", "A"]);
        expect(pushHistoryEntry([entry("A")], entry("B"), -1)).toEqual([]);
    });
});

describe("parseStoredHistory", () => {
    it("returns an empty history for missing or malformed content", () => {
        expect(parseStoredHistory(null)).toEqual([]);
        expect(parseStoredHistory("")).toEqual([]);
        expect(parseStoredHistory("{not json")).toEqual([]);
        expect(parseStoredHistory(JSON.stringify({ query: "x" }))).toEqual([]);
    });

    it("keeps valid entries and drops invalid ones", () => {
        const valid = entry("SELECT 1");
        const failed = entry("SELECT x", { status: "error", error: "no such column", durationMs: null });
        const raw = JSON.stringify([
            valid,
            { ...valid, status: "pending" },
            { ...valid, rows: "3" },
            { ...valid, durationMs: "4" },
            { ...valid, error: 42 },
            { ...valid, isSelect: 1 },
            { ...valid, executedAt: null },
            { ...valid, query: 7 },
            null,
            "SELECT 2",
            failed,
        ]);

        expect(parseStoredHistory(raw)).toEqual([valid, failed]);
    });

    it("applies the limit", () => {
        const raw = JSON.stringify([entry("A"), entry("B"), entry("C")]);

        expect(parseStoredHistory(raw, 2).map(e => e.query)).toEqual(["A", "B"]);
        expect(parseStoredHistory(raw, -3)).toEqual([]);
    });
});

describe("compactQuery", () => {
    it("collapses whitespace and line breaks", () => {
        expect(compactQuery("  SELECT *\n\tFROM  t\r\n WHERE id = 1 ")).toBe("SELECT * FROM t WHERE id = 1");
    });
});

describe("formatExecutionTime", () => {
    it("formats sub-millisecond, millisecond and second durations", () => {
        expect(formatExecutionTime(0.4)).toBe("< 1 ms");
        expect(formatExecutionTime(1)).toBe("1.0 ms");
        expect(formatExecutionTime(12.34)).toBe("12.3 ms");
        expect(formatExecutionTime(999.9)).toBe("999.9 ms");
        expect(formatExecutionTime(1000)).toBe("1.00 s");
        expect(formatExecutionTime(1254)).toBe("1.25 s");
    });
});

describe("historyStorageKey", () => {
    it("namespaces the key per database", () => {
        expect(historyStorageKey("C:\\data\\shop.db")).toBe("sql-history:C:\\data\\shop.db");
        expect(historyStorageKey("a")).not.toBe(historyStorageKey("b"));
    });
});
