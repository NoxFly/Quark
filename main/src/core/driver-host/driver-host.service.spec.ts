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
import type { R_SqlExecResponse } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SQL_FIRST_PAGE_SIZE, type DriverHostResponse } from "src/core/driver-host/driver-host.protocol";
import { DriverHost } from "src/core/driver-host/driver-host.service";
import { createDriver } from "src/core/drivers/driver-factory";

describe("DriverHost", () => {
    let dir: string;
    let host: DriverHost;
    let nextId = 1;

    const call = (method: string, ...args: unknown[]): Promise<DriverHostResponse> =>
        host.handle({ id: nextId++, kind: "call", method, args });

    const result = async <T>(method: string, ...args: unknown[]): Promise<T> => {
        const response = await call(method, ...args);

        if (!response.ok) {
            throw new Error(response.error);
        }

        return response.result as T;
    };

    beforeEach(async () => {
        dir = mkdtempSync(join(tmpdir(), "quark-host-"));
        host = new DriverHost(createDriver);

        await result("open", join(dir, "host.db"));
        await result("execSql", "CREATE TABLE numbers (n INTEGER)");
        await result(
            "execSql",
            "INSERT INTO numbers (n) WITH RECURSIVE s(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM s WHERE value < 1200) SELECT value FROM s",
        );
    });

    afterEach(async () => {
        await host.dispose();
        rmSync(dir, { recursive: true, force: true });
    });

    it("returns the driver state with every response", async () => {
        const response = await call("getSchema");

        expect(response.ok).toBe(true);
        expect(response.state.isOpen).toBe(true);
        expect(response.state.path).toContain("host.db");

        const closed = await call("close");
        expect(closed.state.isOpen).toBe(false);
    });

    it("sends only the first page of a SELECT and serves the rest on demand", async () => {
        const first = await result<R_SqlExecResponse>("execSqlPaged", "SELECT n FROM numbers ORDER BY n");

        expect(first.totalRows).toBe(1200);
        expect(first.rows).toHaveLength(SQL_FIRST_PAGE_SIZE);
        expect(first.resultId).toBeTypeOf("string");
        expect(first.truncated).toBe(false);

        const page = await result<{ rows: unknown[][] }>("fetchSqlRows", first.resultId, 1190, 50);
        expect(page.rows).toEqual([[1191], [1192], [1193], [1194], [1195], [1196], [1197], [1198], [1199], [1200]]);
    });

    it("does not keep small results", async () => {
        const small = await result<R_SqlExecResponse>("execSqlPaged", "SELECT n FROM numbers LIMIT 3");

        expect(small.rows).toHaveLength(3);
        expect(small.resultId).toBeNull();
    });

    it("forgets the oldest results beyond the cache size", async () => {
        const ids: string[] = [];

        for (let i = 0; i < 5; i++) {
            ids.push((await result<R_SqlExecResponse>("execSqlPaged", "SELECT n FROM numbers")).resultId!);
        }

        const expired = await call("fetchSqlRows", ids[0], 0, 10);
        expect(expired.ok).toBe(false);

        const kept = await call("fetchSqlRows", ids[4], 0, 10);
        expect(kept.ok).toBe(true);
    });

    it("invalidates kept results when the connection closes", async () => {
        const { resultId } = await result<R_SqlExecResponse>("execSqlPaged", "SELECT n FROM numbers");

        await result("close");

        expect((await call("fetchSqlRows", resultId, 0, 10)).ok).toBe(false);
    });

    it("rejects anything that is not a public driver method", async () => {
        for (const method of ["constructor", "_private", "doesNotExist", "isOpen"]) {
            const response = await call(method);

            expect(response.ok).toBe(false);
        }
    });

    it("reports driver errors as failed responses", async () => {
        const response = await call("execSql", "SELECT * FROM missing_table");

        expect(response.ok).toBe(false);
        expect(response.ok ? "" : response.error).toContain("missing_table");
    });

    it("switches to another driver type and closes the previous connection", async () => {
        const response = await host.handle({ id: nextId++, kind: "init", driverType: "postgresql" });

        expect(response.ok).toBe(true);
        expect(response.state.isOpen).toBe(false);
    });
});
