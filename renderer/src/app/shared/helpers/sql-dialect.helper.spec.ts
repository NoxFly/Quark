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
import { SqlSnippetScope } from "src/app/core/models/sql-completion.model";
import { isKeywordSupported, resolveSqlDialect } from "src/app/shared/helpers/sql-dialect.helper";

function snippetBody(driver: Parameters<typeof resolveSqlDialect>[0], prefix: string): string | undefined {
    return resolveSqlDialect(driver).snippets.find(snippet => snippet.prefix === prefix)?.body;
}

describe("resolveSqlDialect", () => {
    it("shares a dialect between the engines that speak it", () => {
        expect(resolveSqlDialect("libsql")).toBe(resolveSqlDialect("sqlite"));
        expect(resolveSqlDialect("azure")).toBe(resolveSqlDialect("mssql"));
    });

    it("falls back to generic SQL without connection or without SQL", () => {
        const generic = resolveSqlDialect(null);

        expect(resolveSqlDialect("mongodb")).toBe(generic);
        expect(generic.statementKeywords).toContain("SELECT");
        expect(generic.specificKeywords.size).toBe(0);
    });

    it("quotes identifiers the way each engine does", () => {
        expect(resolveSqlDialect("mysql").identifierQuote).toEqual({ open: "`", close: "`" });
        expect(resolveSqlDialect("mssql").identifierQuote).toEqual({ open: "[", close: "]" });
        expect(resolveSqlDialect("postgresql").identifierQuote).toEqual({ open: "\"", close: "\"" });
    });

    it("only lets T-SQL chain statements without semicolons", () => {
        expect(resolveSqlDialect("mssql").implicitStatementSeparator).toBe(true);
        expect(resolveSqlDialect("sqlite").implicitStatementSeparator).toBe(false);
    });
});

describe("isKeywordSupported", () => {
    it("keeps the common keywords everywhere", () => {
        for (const driver of ["sqlite", "mysql", "postgresql", "oracle", "mssql"] as const) {
            expect(isKeywordSupported(resolveSqlDialect(driver), "WHERE")).toBe(true);
            expect(isKeywordSupported(resolveSqlDialect(driver), "GROUP BY")).toBe(true);
        }
    });

    it("keeps a specific keyword to the dialects that know it", () => {
        expect(isKeywordSupported(resolveSqlDialect("sqlite"), "LIMIT")).toBe(true);
        expect(isKeywordSupported(resolveSqlDialect("mssql"), "LIMIT")).toBe(false);
        expect(isKeywordSupported(resolveSqlDialect("mssql"), "TOP")).toBe(true);
        expect(isKeywordSupported(resolveSqlDialect("postgresql"), "ILIKE")).toBe(true);
        expect(isKeywordSupported(resolveSqlDialect("mysql"), "ILIKE")).toBe(false);
        expect(isKeywordSupported(resolveSqlDialect(null), "LIMIT")).toBe(false);
    });
});

describe("dialect snippets", () => {
    it("converts the placeholders to the Monaco syntax", () => {
        expect(snippetBody("sqlite", "sel")).toMatch(/^SELECT \$\{1:\*\} FROM \$\{2:table\}$/);
        expect(snippetBody("sqlite", "ct")).toContain("\t$0\n");
    });

    it("pages the rows the way each engine does", () => {
        expect(snippetBody("sqlite", "sell")).toContain("LIMIT");
        expect(snippetBody("oracle", "sell")).toContain("FETCH FIRST");
        expect(snippetBody("mssql", "sell")).toBeUndefined();
        expect(snippetBody("mssql", "top")).toMatch(/^SELECT TOP \$\{1:100\}/);
    });

    it("scopes the join and expression snippets", () => {
        const scopes = new Map(resolveSqlDialect("sqlite").snippets.map(snippet => [snippet.prefix, snippet.scope]));

        expect(scopes.get("ij")).toBe(SqlSnippetScope.Join);
        expect(scopes.get("case")).toBe(SqlSnippetScope.Expression);
        expect(scopes.get("sel")).toBe(SqlSnippetScope.Statement);
    });
});
