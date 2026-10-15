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
import { planCascadeDelete } from "src/core/services/cascade-delete";

describe("planCascadeDelete", () => {
    let dir: string;
    let driver: SqliteDriver;

    beforeEach(async () => {
        dir = mkdtempSync(join(tmpdir(), "quark-cascade-"));
        driver = new SqliteDriver();
        await driver.open(join(dir, "test.db"));

        await driver.execSql("CREATE TABLE country (id INTEGER PRIMARY KEY, name TEXT)");
        await driver.execSql("CREATE TABLE city (id INTEGER PRIMARY KEY, country_id INTEGER REFERENCES country(id))");
        await driver.execSql("CREATE TABLE street (id INTEGER PRIMARY KEY, city_id INTEGER REFERENCES city(id))");
        await driver.execSql("INSERT INTO country (id, name) VALUES (1, 'a'), (2, 'b')");
        await driver.execSql("INSERT INTO city (id, country_id) VALUES (10, 1), (11, 1), (12, 2)");
        await driver.execSql("INSERT INTO street (id, city_id) VALUES (100, 10), (101, 11), (102, 12)");
    });

    afterEach(async () => {
        await driver.close();
        rmSync(dir, { recursive: true, force: true });
    });

    it("refuses a plain delete of a referenced row", async () => {
        await expect(driver.deleteRows("country", [1])).rejects.toThrow(/foreign key/i);
    });

    it("lists dependants first, the requested rows last", async () => {
        const steps = await planCascadeDelete(driver, "country", [1]);

        expect(steps.map(step => step.table)).toEqual(["street", "city", "country"]);
        expect(steps[0]?.rowids.sort()).toEqual([100, 101]);
        expect(steps[1]?.rowids.sort()).toEqual([10, 11]);
        expect(steps[2]?.rowids).toEqual([1]);
    });

    it("lets every step run without violating a constraint", async () => {
        for (const step of await planCascadeDelete(driver, "country", [1])) {
            await driver.deleteRows(step.table, step.rowids);
        }

        const remaining = await driver.execSql("SELECT id FROM street");

        expect(remaining.rows).toEqual([[102]]);
    });

    it("returns only the requested rows when nothing references them", async () => {
        const steps = await planCascadeDelete(driver, "street", [100]);

        expect(steps).toEqual([{ table: "street", rowids: [100] }]);
    });
});
