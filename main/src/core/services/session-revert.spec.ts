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

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteDriver } from "src/core/drivers/sqlite.driver";
import { SessionDiff } from "src/core/services/session-diff";
import { SessionReverter } from "src/core/services/session-revert";

describe("SessionReverter", () => {
    let dir: string;
    let driver: SqliteDriver;
    let diff: SessionDiff;
    let reverter: SessionReverter;

    // Reproduisent la capture faite par `Window` autour de chaque mutation.

    const update = async (table: string, rowid: number, column: string, value: unknown): Promise<void> => {
        const before = await driver.getRow(table, rowid);
        await driver.updateCell(table, rowid, column, value);
        diff.recordUpdate(table, rowid, before, await driver.getRow(table, rowid));
    };

    const insert = async (table: string, values: Record<string, unknown>): Promise<number> => {
        const rowid = await driver.insertRow(table, values);
        diff.recordInsert(table, rowid, await driver.getRow(table, rowid));
        return rowid;
    };

    const remove = async (table: string, rowid: number): Promise<void> => {
        const before = await driver.getRow(table, rowid);
        await driver.deleteRows(table, [rowid]);
        diff.recordDelete(table, rowid, before);
    };

    beforeEach(async () => {
        dir = mkdtempSync(join(tmpdir(), "quark-revert-"));
        driver = new SqliteDriver();

        expect(await driver.open(join(dir, "test.db"))).toBe(false);

        await driver.execSql("PRAGMA foreign_keys = ON");
        await driver.execSql("CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)");
        await driver.execSql("CREATE TABLE notes (body TEXT)");
        await driver.execSql("CREATE TABLE pets (id INTEGER PRIMARY KEY, owner INTEGER REFERENCES people(id), name TEXT)");

        await driver.insertRow("people", { name: "alice", age: 30 });
        await driver.insertRow("people", { name: "bob", age: 40 });
        await driver.insertRow("notes", { body: "first" });
        await driver.insertRow("notes", { body: "second" });
        await driver.insertRow("pets", { owner: 1, name: "rex" });

        diff = new SessionDiff();
        diff.start("test.db");
        reverter = new SessionReverter(driver, diff);
    });

    afterEach(async () => {
        await driver.close();
        rmSync(dir, { recursive: true, force: true });
    });

    it("restores the original values of an update", async () => {
        await update("people", 1, "name", "alicia");
        await update("people", 1, "age", 31);

        const result = await reverter.revertRow({ table: "people", rowid: 1 });

        expect(result.reverted).toBe(1);
        expect(result.failures).toEqual([]);
        expect(await driver.getRow("people", 1)).toMatchObject({ name: "alice", age: 30 });
        expect(diff.getSummary().rows).toBe(0);
    });

    it("deletes a row inserted during the session", async () => {
        const rowid = await insert("people", { name: "carol", age: 22 });

        const result = await reverter.revertRow({ table: "people", rowid });

        expect(result.reverted).toBe(1);
        expect(await driver.getRow("people", rowid)).toBeNull();
        expect(diff.getSummary().rows).toBe(0);
    });

    it("reinserts a deleted row under its original rowid", async () => {
        // `notes` n'a pas d'INTEGER PRIMARY KEY : seul le rowid identifie la ligne.
        await remove("notes", 1);

        const result = await reverter.revertRow({ table: "notes", rowid: 1 });

        expect(result.reverted).toBe(1);
        expect((await driver.getRow("notes", 1))?.["body"]).toBe("first");
        expect(diff.getSummary().rows).toBe(0);
    });

    it("refuses to overwrite a row changed outside the journal", async () => {
        await update("people", 1, "name", "alicia");
        await driver.execSql("UPDATE people SET name = 'raw' WHERE id = 1");

        const result = await reverter.revertRow({ table: "people", rowid: 1 });

        expect(result.reverted).toBe(0);
        expect(result.failures[0]?.reason).toBe("row-changed");
        expect((await driver.getRow("people", 1))?.["name"]).toBe("raw");
        expect(diff.getSummary().rows).toBe(1);
    });

    it("refuses entries without an original image and untracked rows", async () => {
        diff.recordDelete("people", 2, null);

        expect(diff.getRow("people", 2)?.revertible).toBe(false);
        expect((await reverter.revertRow({ table: "people", rowid: 2 })).failures[0]?.reason).toBe("not-revertible");
        expect((await reverter.revertRow({ table: "people", rowid: 99 })).failures[0]?.reason).toBe("not-tracked");
    });

    it("does not touch opaque entries", async () => {
        diff.recordOpaque({ category: "sql", label: "SQL", detail: "DELETE FROM notes" });
        await update("people", 1, "name", "alicia");

        const result = await reverter.revertAll();

        expect(result.reverted).toBe(1);
        expect(diff.getSummary()).toEqual({ tables: 0, rows: 0, opaque: 1 });
    });

    it("reverts every change in foreign-key order, in one transaction", async () => {
        // Un parent supprimé dont l'enfant a été réaffecté à un parent inséré :
        // il faut réinsérer bob, rétablir le propriétaire, puis supprimer dave.
        await update("pets", 1, "owner", 2);
        await remove("people", 1);
        const dave = await insert("people", { name: "dave", age: 50 });
        await update("pets", 1, "owner", dave);
        const kitten = await insert("pets", { owner: dave, name: "tom" });
        await remove("notes", 2);

        const result = await reverter.revertAll();

        expect(result.failures).toEqual([]);
        expect(result.transactional).toBe(true);
        expect(result.reverted).toBe(5);
        expect(await driver.getRow("people", 1)).toMatchObject({ name: "alice" });
        expect(await driver.getRow("people", dave)).toBeNull();
        expect(await driver.getRow("pets", kitten)).toBeNull();
        expect((await driver.getRow("pets", 1))?.["owner"]).toBe(1);
        expect((await driver.getRow("notes", 2))?.["body"]).toBe("second");
        expect(diff.getSummary().rows).toBe(0);
        expect(driver.isInTransaction).toBe(false);
    });

    it("restricts a bulk revert to the requested tables", async () => {
        await update("people", 1, "name", "alicia");
        await remove("notes", 1);

        const result = await reverter.revertAll(undefined, ["notes"]);

        expect(result.reverted).toBe(1);
        expect((await driver.getRow("people", 1))?.["name"]).toBe("alicia");
        expect(diff.listRows().map(entry => entry.table)).toEqual(["people"]);
    });

    it("rolls everything back when one row cannot be reverted", async () => {
        await update("people", 1, "name", "alicia");
        await update("people", 2, "name", "robert");
        await driver.execSql("UPDATE people SET name = 'raw' WHERE id = 2");

        const result = await reverter.revertAll();

        expect(result.transactional).toBe(true);
        expect(result.rolledBack).toBe(true);
        expect(result.reverted).toBe(0);
        expect(result.failures.map(failure => failure.reason)).toEqual(["row-changed"]);
        // Tout ou rien : la première ligne, annulable, n'a pas été touchée.
        expect((await driver.getRow("people", 1))?.["name"]).toBe("alicia");
        expect(diff.getSummary().rows).toBe(2);
        expect(driver.isInTransaction).toBe(false);
    });

    it("runs inside an open transaction and reports failures row by row", async () => {
        await driver.beginTransaction();
        diff.beginTransaction();

        await update("people", 1, "name", "alicia");
        await update("people", 2, "name", "robert");
        await driver.execSql("UPDATE people SET name = 'raw' WHERE id = 2");

        const result = await reverter.revertAll();

        expect(result.transactional).toBe(false);
        expect(result.reverted).toBe(1);
        expect(result.failures).toHaveLength(1);
        expect(driver.isInTransaction).toBe(true);
        expect((await driver.getRow("people", 1))?.["name"]).toBe("alice");

        // Le ROLLBACK de l'utilisateur défait aussi l'annulation, journal compris.
        await driver.rollback();
        diff.rollbackTransaction();

        expect(diff.getSummary().rows).toBe(0);
    });
});
