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

describe("SqliteDriver", () => {
    let dir: string;
    let file: string;
    let driver: SqliteDriver;

    beforeEach(async () => {
        dir = mkdtempSync(join(tmpdir(), "quark-sqlite-"));
        file = join(dir, "test.db");
        driver = new SqliteDriver();

        expect(await driver.open(file)).toBe(false);

        await driver.execSql("CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)");

        for (let i = 1; i <= 30; i++) {
            await driver.insertRow("people", { name: `person ${i}`, age: i });
        }
    });

    afterEach(async () => {
        await driver.close();
        rmSync(dir, { recursive: true, force: true });
    });

    it("exposes the schema of the open database", async () => {
        const schema = await driver.getSchema();
        const people = schema.tables.find(table => table.name === "people");

        expect(people?.fields.map(field => field.name)).toEqual(["id", "name", "age"]);
        expect(people?.fields.find(field => field.name === "id")?.pk).toBeTruthy();
    });

    it("pages, sorts and filters table data", async () => {
        const page = await driver.getTableData("people", 10, 5, "age", "DESC");

        expect(page.totalCount).toBe(30);
        expect(page.records).toHaveLength(5);
        expect(page.records[0]?.["age"]).toBe(20);

        const filtered = await driver.getTableData("people", 0, 50, undefined, undefined, "person 2", "fulltext");
        // « person 2 », puis « person 20 » à « person 29 ».
        expect(filtered.totalCount).toBe(11);

        const sql = await driver.getTableData("people", 0, 50, undefined, undefined, "age > 25", "sql");
        expect(sql.totalCount).toBe(5);
    });

    it("updates, reads and deletes rows", async () => {
        await driver.updateCell("people", 1, "name", "renamed");
        expect((await driver.getRow("people", 1))?.["name"]).toBe("renamed");

        await driver.batchUpdate("people", [2, 3], "age", 99);
        expect((await driver.getRow("people", 3))?.["age"]).toBe(99);

        await driver.deleteRows("people", [1, 2]);
        expect(await driver.getRow("people", 1)).toBeNull();
        expect((await driver.getTableData("people", 0, 50)).totalCount).toBe(28);
    });

    it("rolls back a transaction", async () => {
        await driver.beginTransaction();
        await driver.deleteRows("people", [1]);
        expect(driver.isInTransaction).toBe(true);

        await driver.rollback();

        expect(driver.isInTransaction).toBe(false);
        expect(await driver.getRow("people", 1)).not.toBeNull();
    });

    it("keeps duplicate column names and column order in SQL results", async () => {
        const result = await driver.execSql("SELECT a.id, a.name, b.name FROM people a JOIN people b ON b.id = a.id WHERE a.id = 4");

        expect(result.isSelect).toBe(true);
        expect(result.columns).toEqual(["id", "name", "name"]);
        expect(result.rows).toEqual([[4, "person 4", "person 4"]]);
    });

    it("stops reading a SELECT at the row cap", async () => {
        const result = await driver.execSql("SELECT * FROM people", 10);

        expect(result.rows).toHaveLength(10);
        expect(result.truncated).toBe(true);

        const complete = await driver.execSql("SELECT * FROM people", 100);
        expect(complete.rows).toHaveLength(30);
        expect(complete.truncated).toBe(false);
    });

    it("reports affected rows for statements", async () => {
        const result = await driver.execSql("UPDATE people SET age = 0 WHERE age < 5");

        expect(result.isSelect).toBe(false);
        expect(result.rowsAffected).toBe(4);
    });

    it("encrypts, then requires the exact password, quotes included", async () => {
        // Les apostrophes cassaient l'ancien `PRAGMA key='...'` concaténé.
        const password = `it's "a" secret`;

        await driver.changePassword(password);
        await driver.close();

        expect(await driver.open(file)).toBe(true);
        await expect(driver.unlock("wrong")).rejects.toThrow();
        await driver.unlock(password);

        expect((await driver.getTableData("people", 0, 1)).totalCount).toBe(30);

        // Une clé vide retire le chiffrement.
        await driver.changePassword(null);
        await driver.close();
        expect(await driver.open(file)).toBe(false);
    });

    it("exports JSON, CSV and XLSX", async () => {
        const json = await driver.exportData("people", "json", [1, 2]);
        expect(JSON.parse(json.data)).toHaveLength(2);

        const csv = await driver.exportData("people", "csv");
        expect(csv.data.split(/\r?\n/)[0]).toContain("name");

        const xlsx = await driver.exportData("people", "xlsx");
        expect(xlsx.filename).toBe("people.xlsx");
        // Un classeur XLSX est une archive ZIP : signature « PK ».
        expect(Buffer.from(xlsx.data, "base64").subarray(0, 2).toString("latin1")).toBe("PK");
    });

    it("previews then imports CSV data", async () => {
        const csv = "name,age\nimported one,41\nimported two,42\n";

        const preview = await driver.previewImport("people", "csv", csv);
        expect(preview.totalRows).toBe(2);
        expect(preview.errors).toEqual([]);

        await driver.importData("people", "csv", csv, "insert");
        expect((await driver.getTableData("people", 0, 50)).totalCount).toBe(32);
    });
});
