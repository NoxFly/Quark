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

// Client complet (module natif) : il sait ouvrir une base locale, et ses
// résultats ont la même forme que ceux du client web utilisé en production.
import { createClient } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LibsqlDriver } from "src/core/drivers/libsql.driver";

describe("LibsqlDriver", () => {
    // Base en mémoire : un fichier resterait verrouillé par le module natif
    // après la fermeture, le temps que Windows le libère.
    const url = ":memory:";
    let driver: LibsqlDriver;

    beforeEach(async () => {
        driver = new LibsqlDriver(createClient);

        await driver.configureConnection({ authToken: "token", timeoutSeconds: 5 });
        expect(await driver.open(url)).toBe(false);

        await driver.execSql("CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT, age INTEGER, big INTEGER)");

        for (let i = 1; i <= 12; i++) {
            await driver.insertRow("people", { name: `person ${i}`, age: i, big: i });
        }
    });

    afterEach(async () => {
        await driver.close();
    });

    it("reads the schema in one batch", async () => {
        const schema = await driver.getSchema();
        const people = schema.tables.find(table => table.name === "people");

        expect(schema.driverType).toBe("libsql");
        expect(schema.path).toBe(url);
        expect(people?.recordCount).toBe(12);
        expect(people?.fields.find(field => field.name === "id")?.pk).toBe(true);
    });

    it("pages, sorts and filters like the file driver", async () => {
        const page = await driver.getTableData("people", 2, 3, "age", "DESC");

        expect(page.totalCount).toBe(12);
        expect(page.records.map(record => record["age"])).toEqual([10, 9, 8]);
        expect(page.records[0]?.["rowid"]).toBe(10);

        expect((await driver.getTableData("people", 0, 50, undefined, undefined, "person 1", "fulltext")).totalCount).toBe(4);
        expect((await driver.getTableData("people", 0, 50, undefined, undefined, "age > 9", "sql")).totalCount).toBe(3);
        expect((await driver.getTableData("people", 0, 50, undefined, undefined, "drop table people", "sql")).totalCount).toBe(0);
    });

    it("updates, deletes and truncates rows", async () => {
        await driver.updateCell("people", 1, "name", "renamed");
        await driver.batchUpdate("people", [2, 3], "age", 99);
        await driver.deleteRows("people", [4]);

        expect((await driver.getRow("people", 1))?.["name"]).toBe("renamed");
        expect((await driver.getRow("people", 3))?.["age"]).toBe(99);
        expect(await driver.getRow("people", 4)).toBeNull();

        expect(await driver.truncateTable("people")).toBe(11);
        expect((await driver.getTableData("people", 0, 10)).totalCount).toBe(0);
    });

    it("returns integers beyond 2^53 as strings instead of throwing", async () => {
        await driver.execSql("UPDATE people SET big = 9007199254740993 WHERE id = 1");

        const result = await driver.execSql("SELECT big FROM people WHERE id IN (1, 2) ORDER BY id");

        expect(result.rows).toEqual([["9007199254740993"], [2]]);
    });

    it("caps SQL results and treats RETURNING writes as modifications", async () => {
        const capped = await driver.execSql("SELECT * FROM people", 5);
        expect(capped.rows).toHaveLength(5);
        expect(capped.truncated).toBe(true);

        const write = await driver.execSql("DELETE FROM people WHERE id = 1 RETURNING id");
        expect(write.isSelect).toBe(false);
        expect(write.rowsAffected).toBe(1);
    });

    it("imports atomically in one batch", async () => {
        await driver.importData("people", "csv", "name,age\nimported,50\n", "insert");
        expect((await driver.getTableData("people", 0, 50)).totalCount).toBe(13);

        // Une ligne en échec (clé primaire en double) annule tout le lot.
        const duplicated = JSON.stringify([{ id: 100, name: "a" }, { id: 100, name: "b" }]);
        await expect(driver.importData("people", "json", duplicated, "insert")).rejects.toThrow();
        expect((await driver.getTableData("people", 0, 50)).totalCount).toBe(13);
    });

    it("manages indexes and schema changes", async () => {
        await driver.createIndex("people", "idx_age", ["age"], false);
        expect((await driver.getIndexes("people")).map(index => index.columns)).toEqual([["age"]]);

        const email = { name: "email", type: "TEXT", notNull: false, defaultValue: null, primaryKey: false, unique: false };
        await driver.alterTable({ action: "add-column", table: "people", column: email });
        expect((await driver.getSchema()).tables[0]?.fields.map(field => field.name)).toContain("email");

        await driver.dropTable("people");
        expect((await driver.getSchema()).tables).toHaveLength(0);
    });

    it("refuses interactive transactions and encryption", async () => {
        await expect(driver.beginTransaction()).rejects.toThrow("not supported");
        await expect(driver.changePassword("x")).rejects.toThrow();
        expect(driver.isInTransaction).toBe(false);
    });

    it("reports an unreachable server as a failed open", async () => {
        const offline = new LibsqlDriver();

        await offline.configureConnection({ timeoutSeconds: 5 });
        await expect(offline.open("http://127.0.0.1:1")).rejects.toThrow("Failed to connect");
        expect(offline.isOpen).toBe(false);
    });
});
