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
import type { DatabaseDriverType } from "@shared/driver";
import type { FieldDef, TableSchema } from "@shared/types";
import { SqlCandidateKind, type SqlCompletionCandidate } from "src/app/core/models/sql-completion.model";
import {
    adaptKeywordCase,
    buildSqlCandidates,
    describeSqlColumn,
    findInlineCompletion,
    indexSqlTables,
    quoteSqlIdentifier,
} from "src/app/shared/helpers/sql-completion.helper";
import { analyzeSqlContext } from "src/app/shared/helpers/sql-context.helper";
import { resolveSqlDialect } from "src/app/shared/helpers/sql-dialect.helper";

function field(name: string, overrides: Partial<FieldDef> = {}): FieldDef {
    return { name, type: "INTEGER", notnull: false, dflt_value: null, pk: false, fk: null, ...overrides };
}

function table(name: string, fields: string[]): TableSchema {
    return { name, fields: fields.map(fieldName => field(fieldName)), weight: 0, recordCount: 0 };
}

const SCHEMA = indexSqlTables([
    table("users", ["id", "name", "email"]),
    table("orders", ["id", "user_id", "total"]),
    table("activity_logs", ["id", "activity_type"]),
    table("cash_registers", ["id"]),
    table("cash_register_entries", ["id"]),
    table("order", ["id"]),
]);

/**
 * Suggestions d'une requête dont `|` marque le curseur.
 */
function suggest(sql: string, driver: DatabaseDriverType | null = "sqlite"): SqlCompletionCandidate[] {
    const offset = sql.indexOf("|");
    const context = analyzeSqlContext(sql.replace("|", ""), offset);

    return buildSqlCandidates(context, SCHEMA, resolveSqlDialect(driver));
}

/**
 * Complétion fantôme d'une requête dont `|` marque le curseur.
 */
function ghost(sql: string, driver: DatabaseDriverType | null = "sqlite"): string | null {
    const offset = sql.indexOf("|");
    const context = analyzeSqlContext(sql.replace("|", ""), offset);
    const candidates = buildSqlCandidates(context, SCHEMA, resolveSqlDialect(driver));

    return findInlineCompletion(candidates, context.prefix);
}

function labels(candidates: readonly SqlCompletionCandidate[], kind?: SqlCandidateKind): string[] {
    return candidates.filter(candidate => kind === undefined || candidate.kind === kind).map(candidate => candidate.label);
}

describe("buildSqlCandidates — statement start", () => {
    it("offers the statement keywords and snippets of the dialect, never tables", () => {
        const sqlite = suggest("|");

        expect(labels(sqlite, SqlCandidateKind.Keyword)).toEqual(expect.arrayContaining(["SELECT", "PRAGMA"]));
        expect(labels(sqlite, SqlCandidateKind.Snippet)).toEqual(expect.arrayContaining(["sel", "sell", "pragma"]));
        expect(labels(sqlite, SqlCandidateKind.Table)).toEqual([]);

        const tsql = suggest("|", "mssql");

        expect(labels(tsql, SqlCandidateKind.Keyword)).toContain("EXEC");
        expect(labels(tsql, SqlCandidateKind.Keyword)).not.toContain("PRAGMA");
        expect(labels(tsql, SqlCandidateKind.Snippet)).toContain("top");
        expect(labels(tsql, SqlCandidateKind.Snippet)).not.toContain("sell");
    });

    it("inserts snippets with Monaco placeholders", () => {
        const select = suggest("|").find(candidate => candidate.label === "sel");

        expect(select).toMatchObject({ isSnippet: true, inlineText: null });
        expect(select?.insertText).toMatch(/^SELECT \$\{1:\*\} FROM \$\{2:table\}$/);
        expect(select?.description).toBe("SELECT … FROM …");
    });

    it("writes keywords in the case of the typed word", () => {
        expect(labels(suggest("sel|"), SqlCandidateKind.Keyword)).toContain("select");
        expect(labels(suggest("SEL|"), SqlCandidateKind.Keyword)).toContain("SELECT");
    });
});

describe("buildSqlCandidates — tables", () => {
    it("offers every table after FROM, delimited when needed", () => {
        const candidates = suggest("SELECT * FROM |");
        const reserved = candidates.find(candidate => candidate.label === "order");

        expect(labels(candidates, SqlCandidateKind.Table)).toEqual(SCHEMA.list.map(schemaTable => schemaTable.name));
        expect(reserved).toMatchObject({ insertText: "\"order\"", inlineText: null, retrigger: false });
    });

    it("offers the common table expressions with the tables", () => {
        const candidates = suggest("WITH recent AS (SELECT 1) SELECT * FROM |");

        expect(labels(candidates, SqlCandidateKind.Cte)).toEqual(["recent"]);
    });
});

describe("buildSqlCandidates — keywords of the dialect", () => {
    it("filters the clauses unknown to the dialect", () => {
        const sqlite = labels(suggest("SELECT * FROM users |"), SqlCandidateKind.Keyword);
        const tsql = labels(suggest("SELECT * FROM users |", "mssql"), SqlCandidateKind.Keyword);
        const oracle = labels(suggest("SELECT * FROM users |", "oracle"), SqlCandidateKind.Keyword);

        expect(sqlite).toEqual(expect.arrayContaining(["WHERE", "LIMIT", "EXCEPT"]));
        expect(sqlite).not.toContain("CROSS APPLY");
        expect(tsql).toEqual(expect.arrayContaining(["WHERE", "CROSS APPLY"]));
        expect(tsql).not.toContain("LIMIT");
        expect(oracle).toContain("MINUS");
        expect(oracle).not.toContain("EXCEPT");
    });

    it("offers the join snippets after a table of the FROM", () => {
        expect(labels(suggest("SELECT * FROM users |"), SqlCandidateKind.Snippet)).toEqual(["ij", "lj"]);
        expect(labels(suggest("DELETE FROM users |"), SqlCandidateKind.Snippet)).toEqual([]);
    });

    it("chains T-SQL statements without semicolons", () => {
        expect(labels(suggest("SELECT * FROM users WHERE id = 1 |", "mssql"))).toContain("UPDATE");
        expect(labels(suggest("SELECT * FROM users WHERE id = 1 |"))).not.toContain("UPDATE");
    });

    it("offers the value keywords the dialect accepts", () => {
        const sqlite = labels(suggest("INSERT INTO users VALUES (|"), SqlCandidateKind.Keyword);
        const mysql = labels(suggest("INSERT INTO users VALUES (|", "mysql"), SqlCandidateKind.Keyword);

        expect(sqlite).toEqual(expect.arrayContaining(["NULL", "TRUE", "CURRENT_TIMESTAMP"]));
        expect(sqlite).not.toContain("DEFAULT");
        expect(mysql).toContain("DEFAULT");
        expect(labels(suggest("INSERT INTO users VALUES (|"), SqlCandidateKind.Column)).toEqual([]);
    });
});

describe("buildSqlCandidates — columns", () => {
    it("offers the tables as qualifiers when the query cites none", () => {
        const candidates = suggest("SELECT |");
        const users = candidates.find(candidate => candidate.label === "users");

        expect(candidates[0]?.kind).toBe(SqlCandidateKind.Star);
        expect(labels(candidates, SqlCandidateKind.Column)).toEqual([]);
        expect(users).toMatchObject({ kind: SqlCandidateKind.Table, insertText: "users.", retrigger: true });
    });

    it("only offers the columns of the tables of the query", () => {
        const candidates = suggest("SELECT | FROM users u JOIN orders o ON o.user_id = u.id");
        const columns = candidates.filter(candidate => candidate.kind === SqlCandidateKind.Column);

        expect(columns.map(column => column.insertText)).toEqual(["u.id", "name", "email", "o.id", "user_id", "total"]);
        expect(columns.map(column => column.owner)).not.toContain("activity_logs");
        expect(labels(candidates, SqlCandidateKind.Alias)).toEqual(["u", "o"]);
    });

    it("qualifies every column of a table joined to itself", () => {
        const candidates = suggest("SELECT | FROM users a JOIN users b ON a.id = b.id");
        const inserts = candidates.filter(candidate => candidate.kind === SqlCandidateKind.Column).map(c => c.insertText);

        expect(inserts).toEqual(["a.id", "a.name", "a.email", "b.id", "b.name", "b.email"]);
    });

    it("offers the columns of the qualified alias or table", () => {
        expect(labels(suggest("SELECT * FROM users u WHERE u.|"))).toEqual(["id", "name", "email"]);
        expect(labels(suggest("SELECT u.| FROM users u"))).toEqual(["id", "name", "email", "*"]);
        expect(labels(suggest("SELECT orders.|"))).toEqual(["id", "user_id", "total", "*"]);
        expect(labels(suggest("SELECT * FROM users WHERE x.|"))).toEqual([]);
    });

    it("offers the target columns of an INSERT and the star inside COUNT", () => {
        expect(labels(suggest("INSERT INTO users (|"))).toEqual(["id", "name", "email"]);

        const count = suggest("SELECT COUNT(|) FROM users");

        expect(count[0]?.kind).toBe(SqlCandidateKind.Star);
        expect(labels(count, SqlCandidateKind.Column)).toEqual(["id", "name", "email"]);
    });

    it("offers functions after the columns, with the cursor between parentheses", () => {
        const candidates = suggest("SELECT | FROM users");
        const count = candidates.find(candidate => candidate.label === "COUNT");
        const kinds = candidates.map(candidate => candidate.kind);
        const firstFunction = kinds.indexOf(SqlCandidateKind.Function);
        const lastColumn = kinds.lastIndexOf(SqlCandidateKind.Column);

        expect(count).toMatchObject({ insertText: "COUNT($0)", isSnippet: true, inlineText: "COUNT" });
        expect(firstFunction).toBeGreaterThan(lastColumn);
    });

    it("suggests nothing where a name must be invented", () => {
        expect(suggest("CREATE TABLE t (|")).toEqual([]);
    });
});

describe("findInlineCompletion", () => {
    it("completes a keyword in the case of the typed word", () => {
        expect(ghost("SEL|")).toBe("SELECT");
        expect(ghost("sel|")).toBe("select");
        expect(ghost("Sel|")).toBe("SelECT");
        expect(ghost("DEL|")).toBe("DELETE FROM");
    });

    it("completes a table when a single one continues the typed word", () => {
        expect(ghost("SELECT * FROM activ|")).toBe("activity_logs");
        expect(ghost("SELECT * FROM ord|")).toBeNull();
        expect(ghost("SELECT * FROM cash_reg|")).toBeNull();
    });

    it("waits for two letters and stops once the word is complete", () => {
        expect(ghost("SELECT * FROM a|")).toBeNull();
        expect(ghost("SELECT * FROM users|")).toBeNull();
    });

    it("does not change the case of an identifier", () => {
        expect(ghost("SELECT * FROM ACTIV|")).toBeNull();
    });

    it("completes a column of the query but not one that must be qualified", () => {
        expect(ghost("SELECT em| FROM users")).toBe("email");
        expect(ghost("SELECT tot| FROM users u JOIN orders o ON 1 = 1")).toBe("total");
        expect(ghost("SELECT tot| FROM orders a JOIN orders b ON 1 = 1")).toBeNull();
    });

    it("never completes a snippet", () => {
        expect(ghost("upd|")).toBe("update");
        expect(ghost("cnt|")).toBeNull();
    });
});

describe("adaptKeywordCase", () => {
    it("lowers the keyword only when the typed word is lowercase", () => {
        expect(adaptKeywordCase("GROUP BY", "gro")).toBe("group by");
        expect(adaptKeywordCase("GROUP BY", "Gro")).toBe("GROUP BY");
        expect(adaptKeywordCase("GROUP BY", "")).toBe("GROUP BY");
        expect(adaptKeywordCase("GROUP BY", "_1")).toBe("GROUP BY");
    });
});

describe("quoteSqlIdentifier", () => {
    it("keeps plain identifiers and delimits the others with the dialect quotes", () => {
        expect(quoteSqlIdentifier("users", resolveSqlDialect("sqlite"))).toBe("users");
        expect(quoteSqlIdentifier("order", resolveSqlDialect("sqlite"))).toBe("\"order\"");
        expect(quoteSqlIdentifier("order items", resolveSqlDialect("mysql"))).toBe("`order items`");
        expect(quoteSqlIdentifier("order items", resolveSqlDialect("mssql"))).toBe("[order items]");
    });

    it("doubles the closing delimiter inside the name", () => {
        expect(quoteSqlIdentifier("a\"b", resolveSqlDialect("postgresql"))).toBe("\"a\"\"b\"");
        expect(quoteSqlIdentifier("a]b", resolveSqlDialect("azure"))).toBe("[a]]b]");
    });
});

describe("describeSqlColumn", () => {
    function column(owner: string | null, definition: FieldDef | null): SqlCompletionCandidate {
        return {
            kind: SqlCandidateKind.Column,
            label: definition?.name ?? "",
            insertText: definition?.name ?? "",
            isSnippet: false,
            inlineText: null,
            retrigger: false,
            table: null,
            owner,
            field: definition,
            description: null,
        };
    }

    it("describes the table, the type and the keys of a column", () => {
        const userId = field("user_id", { pk: true, fk: { table: "users", column: "id" } });

        expect(describeSqlColumn(column("orders", userId))).toBe("orders · INTEGER · PK · FK → users");
    });

    it("skips an empty type and ignores suggestions without field", () => {
        expect(describeSqlColumn(column("users", field("x", { type: "" })))).toBe("users");
        expect(describeSqlColumn(column("users", null))).toBeNull();
    });
});
