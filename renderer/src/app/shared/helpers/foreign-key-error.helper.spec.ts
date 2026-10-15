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
import { isForeignKeyError } from "./foreign-key-error.helper";

describe("isForeignKeyError", () => {
    it.each([
        "FOREIGN KEY constraint failed",
        "Cannot delete or update a parent row: a foreign key constraint fails (`db`.`t`)",
        "update or delete on table \"a\" violates foreign key constraint \"fk\" on table \"b\"",
        "The DELETE statement conflicted with the REFERENCE constraint \"FK_x\".",
        "ORA-02292: integrity constraint (X.FK) violated - child record found",
    ])("recognizes %s", message => {
        expect(isForeignKeyError(new Error(message))).toBe(true);
    });

    it("rejects other errors", () => {
        expect(isForeignKeyError(new Error("database is locked"))).toBe(false);
        expect(isForeignKeyError(null)).toBe(false);
    });
});
