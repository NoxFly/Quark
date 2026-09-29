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
import {
    type SqlCompletionContext,
    SqlExpectation,
    SqlReferenceSource,
} from "src/app/core/models/sql-completion.model";
import { analyzeSqlContext, isReservedSqlWord } from "src/app/shared/helpers/sql-context.helper";

/**
 * Analyse une requête dont `|` marque le curseur.
 */
function at(sql: string): SqlCompletionContext {
    const offset = sql.indexOf("|");

    return analyzeSqlContext(sql.replace("|", ""), offset);
}

describe("analyzeSqlContext — prefix and literals", () => {
    it("isolates the word being typed", () => {
        const context = at("SELECT * FROM activ|");

        expect(context.prefix).toBe("activ");
        expect(context.prefixStart).toBe(14);
    });

    it("cuts the prefix at the cursor when it is inside a word", () => {
        expect(at("SEL|ECT").prefix).toBe("SEL");
    });

    it("suggests nothing inside a string, a comment, a delimited identifier or a number", () => {
        expect(at("SELECT 'ab|'").expectation).toBe(SqlExpectation.None);
        expect(at("SELECT 'ab|").expectation).toBe(SqlExpectation.None);
        expect(at("-- SELECT |").expectation).toBe(SqlExpectation.None);
        expect(at("/* x | */ SELECT").expectation).toBe(SqlExpectation.None);
        expect(at("SELECT \"us|").expectation).toBe(SqlExpectation.None);
        expect(at("SELECT 12|").expectation).toBe(SqlExpectation.None);
    });

    it("resumes right after a closed literal or on the line after a comment", () => {
        expect(at("SELECT 'a' |").expectation).toBe(SqlExpectation.Keyword);
        expect(at("-- note\n|").expectation).toBe(SqlExpectation.StatementStart);
    });
});

describe("analyzeSqlContext — statement start", () => {
    it("expects a statement on an empty editor, after a word or after a semicolon", () => {
        expect(at("|").expectation).toBe(SqlExpectation.StatementStart);
        expect(at("SEL|").expectation).toBe(SqlExpectation.StatementStart);
        expect(at("SELECT 1 FROM a; SEL|").expectation).toBe(SqlExpectation.StatementStart);
    });

    it("never offers tables before a statement keyword", () => {
        expect(at("activ|").expectation).toBe(SqlExpectation.StatementStart);
    });

    it("only analyses the statement of the cursor", () => {
        const context = at("SELECT * FROM a; SELECT | FROM b; SELECT * FROM c");

        expect(context.scope.map(reference => reference.table)).toEqual(["b"]);
    });

    it("chains statements after EXPLAIN and inside a procedure body", () => {
        expect(at("EXPLAIN |").expectation).toBe(SqlExpectation.StatementStart);
        expect(at("EXPLAIN QUERY PLAN |").expectation).toBe(SqlExpectation.StatementStart);
        expect(at("PROCEDURE p AS BEGIN |").expectation).toBe(SqlExpectation.StatementStart);
    });
});

describe("analyzeSqlContext — SELECT list", () => {
    it("expects columns or tables right after SELECT, without clause keywords", () => {
        const context = at("SELECT |");

        expect(context.expectation).toBe(SqlExpectation.Column);
        expect(context.allowStar).toBe(true);
        expect(context.keywords).toEqual(["DISTINCT", "TOP", "CASE"]);
        expect(context.scope).toEqual([]);
    });

    it("sees the FROM written after the cursor", () => {
        const context = at("SELECT | FROM users u");

        expect(context.scope).toEqual([
            { table: "users", alias: "u", source: SqlReferenceSource.From, outer: false },
        ]);
    });

    it("expects AS or FROM after a column, FROM after a star", () => {
        expect(at("SELECT a |").keywords).toEqual(["AS", "FROM"]);
        expect(at("SELECT * |").keywords).toEqual(["FROM"]);
        expect(at("SELECT a, |").expectation).toBe(SqlExpectation.Column);
        expect(at("SELECT a AS |").expectation).toBe(SqlExpectation.None);
    });

    it("continues the select list after DISTINCT or TOP n", () => {
        expect(at("SELECT DISTINCT |").expectation).toBe(SqlExpectation.Column);
        expect(at("SELECT TOP |").expectation).toBe(SqlExpectation.None);
        expect(at("SELECT TOP 10 |").expectation).toBe(SqlExpectation.Column);
    });

    it("offers the branches of an open CASE", () => {
        expect(at("SELECT CASE WHEN a |").keywords).toEqual(["WHEN", "THEN", "ELSE", "END", "AS", "FROM"]);
        expect(at("SELECT CASE WHEN a THEN 1 END |").keywords).toEqual(["AS", "FROM"]);
    });
});

describe("analyzeSqlContext — FROM and JOIN", () => {
    it("expects a table after FROM, JOIN or a comma", () => {
        expect(at("SELECT * FROM |").expectation).toBe(SqlExpectation.TableName);
        expect(at("SELECT * FROM a, |").expectation).toBe(SqlExpectation.TableName);
        expect(at("SELECT * FROM a LEFT JOIN |").expectation).toBe(SqlExpectation.TableName);
    });

    it("expects an alias or the next clauses after a table", () => {
        const context = at("SELECT * FROM users |");

        expect(context.expectation).toBe(SqlExpectation.Keyword);
        expect(context.keywords).toEqual(expect.arrayContaining(["AS", "WHERE", "LEFT JOIN", "GROUP BY", "LIMIT"]));
        expect(context.joinSnippets).toBe(true);
        expect(at("SELECT * FROM users u |").keywords).not.toContain("AS");
    });

    it("expects ON after a joined table and completes join modifiers", () => {
        expect(at("SELECT * FROM a JOIN b |").keywords).toEqual(expect.arrayContaining(["AS", "ON", "USING"]));
        expect(at("SELECT * FROM a LEFT |").keywords).toEqual(["JOIN", "OUTER JOIN"]);
        expect(at("SELECT * FROM a LEFT OUTER |").keywords).toEqual(["JOIN"]);
        expect(at("SELECT * FROM a CROSS |").keywords).toEqual(["JOIN", "APPLY"]);
    });

    it("expects a table after a schema qualifier", () => {
        expect(at("SELECT * FROM main.|").expectation).toBe(SqlExpectation.TableName);
    });

    it("reads schemas, aliases and derived tables of the FROM", () => {
        const context = at("SELECT | FROM main.users AS u, \"order items\" oi JOIN (SELECT 1) d ON 1 = 1");

        expect(context.scope).toEqual([
            { table: "users", alias: "u", source: SqlReferenceSource.From, outer: false },
            { table: "order items", alias: "oi", source: SqlReferenceSource.From, outer: false },
            { table: null, alias: "d", source: SqlReferenceSource.Join, outer: false },
        ]);
    });
});

describe("analyzeSqlContext — conditions", () => {
    it("expects an operand after WHERE, ON, AND or an operator", () => {
        expect(at("SELECT * FROM a WHERE |").expectation).toBe(SqlExpectation.Column);
        expect(at("SELECT * FROM a JOIN b ON |").expectation).toBe(SqlExpectation.Column);
        expect(at("SELECT * FROM a WHERE x = 1 AND |").expectation).toBe(SqlExpectation.Column);
        expect(at("SELECT * FROM a WHERE x = |").keywords).toEqual(["NOT", "EXISTS", "CASE", "NULL"]);
    });

    it("expects operators and the next clauses after an operand", () => {
        const keywords = at("SELECT * FROM a WHERE x |").keywords;

        expect(keywords).toEqual(expect.arrayContaining(["AND", "OR", "IS", "IN", "LIKE", "ORDER BY", "LIMIT"]));
    });

    it("offers RETURNING rather than GROUP BY in the WHERE of a DELETE", () => {
        const keywords = at("DELETE FROM a WHERE x = 1 |").keywords;

        expect(keywords).toContain("RETURNING");
        expect(keywords).not.toContain("GROUP BY");
    });

    it("completes IS and IS NOT", () => {
        expect(at("SELECT * FROM a WHERE x IS |").keywords).toEqual(["NULL", "NOT NULL", "NOT", "TRUE", "FALSE", "DISTINCT FROM"]);
        expect(at("SELECT * FROM a WHERE x IS NOT |").keywords).toEqual(["NULL", "DISTINCT FROM", "TRUE", "FALSE"]);
    });

    it("does not take IS DISTINCT FROM for a FROM clause", () => {
        const context = at("SELECT * FROM a WHERE x IS DISTINCT FROM y AND |");

        expect(context.expectation).toBe(SqlExpectation.Column);
        expect(context.scope.map(reference => reference.table)).toEqual(["a"]);
    });

    it("completes a parenthesised condition", () => {
        expect(at("SELECT * FROM a WHERE (x = 1 |").keywords).toEqual(expect.arrayContaining(["AND", "OR"]));
    });
});

describe("analyzeSqlContext — GROUP BY, ORDER BY, LIMIT", () => {
    it("completes BY after GROUP, ORDER and PARTITION", () => {
        expect(at("SELECT a FROM t GROUP |").keywords).toEqual(["BY"]);
        expect(at("SELECT a FROM t ORDER |").keywords).toEqual(["BY"]);
    });

    it("expects columns after BY, then the clause follow-ups", () => {
        expect(at("SELECT a FROM t ORDER BY |").expectation).toBe(SqlExpectation.Column);
        expect(at("SELECT a FROM t ORDER BY a |").keywords).toEqual(expect.arrayContaining(["ASC", "DESC", "LIMIT"]));
        expect(at("SELECT a FROM t ORDER BY a DESC |").keywords).not.toContain("ASC");
        expect(at("SELECT a FROM t GROUP BY a |").keywords).toEqual(expect.arrayContaining(["HAVING", "ORDER BY"]));
    });

    it("waits for a number after LIMIT, then offers OFFSET", () => {
        expect(at("SELECT a FROM t LIMIT |").expectation).toBe(SqlExpectation.None);
        expect(at("SELECT a FROM t LIMIT 10 |").keywords).toEqual(["OFFSET"]);
    });

    it("expects a SELECT after UNION", () => {
        expect(at("SELECT a FROM t UNION |").keywords).toEqual(["SELECT", "ALL"]);
        expect(at("SELECT a FROM t UNION ALL |").keywords).toEqual(["SELECT"]);
    });
});

describe("analyzeSqlContext — qualified columns", () => {
    it("expects a column of the alias after its dot", () => {
        const context = at("SELECT * FROM users u WHERE u.|");

        expect(context.expectation).toBe(SqlExpectation.QualifiedColumn);
        expect(context.qualifier).toBe("u");
        expect(context.allowStar).toBe(false);
    });

    it("allows table.* in the select list", () => {
        const context = at("SELECT u.| FROM users u");

        expect(context.qualifier).toBe("u");
        expect(context.allowStar).toBe(true);
    });

    it("keeps the typed prefix after the dot", () => {
        const context = at("SELECT u.na| FROM users u");

        expect(context.expectation).toBe(SqlExpectation.QualifiedColumn);
        expect(context.prefix).toBe("na");
    });

    it("unquotes a delimited qualifier", () => {
        expect(at("SELECT * FROM \"my table\" WHERE \"my table\".|").qualifier).toBe("my table");
    });
});

describe("analyzeSqlContext — subqueries and functions", () => {
    it("isolates a subquery but keeps the outer tables reachable", () => {
        const context = at("SELECT * FROM a WHERE id IN (SELECT | FROM b)");

        expect(context.expectation).toBe(SqlExpectation.Column);
        expect(context.scope).toEqual([
            { table: "b", alias: null, source: SqlReferenceSource.From, outer: false },
            { table: "a", alias: null, source: SqlReferenceSource.From, outer: true },
        ]);
    });

    it("resolves a correlated qualifier", () => {
        const context = at("SELECT * FROM a WHERE EXISTS (SELECT 1 FROM b WHERE b.a_id = a.|)");

        expect(context.expectation).toBe(SqlExpectation.QualifiedColumn);
        expect(context.qualifier).toBe("a");
    });

    it("offers a subquery at the start of IN, EXISTS and FROM parentheses", () => {
        expect(at("SELECT * FROM a WHERE id IN (|").keywords).toEqual(["SELECT"]);
        expect(at("SELECT * FROM a WHERE EXISTS (|").keywords).toEqual(["SELECT", "WITH"]);
        expect(at("SELECT * FROM (|").keywords).toEqual(["SELECT", "WITH"]);
    });

    it("keeps the query tables in scope inside function arguments", () => {
        const context = at("SELECT COUNT(|) FROM users");

        expect(context.expectation).toBe(SqlExpectation.Column);
        expect(context.allowStar).toBe(true);
        expect(context.keywords).toEqual(["DISTINCT"]);
        expect(context.scope).toEqual([
            { table: "users", alias: null, source: SqlReferenceSource.From, outer: false },
        ]);
    });

    it("does not read the FROM of a function argument as a clause", () => {
        expect(at("SELECT EXTRACT(YEAR FROM |) FROM t").expectation).toBe(SqlExpectation.Column);
    });

    it("offers the window clauses inside OVER", () => {
        expect(at("SELECT ROW_NUMBER() OVER (|").keywords).toEqual(["PARTITION BY", "ORDER BY"]);
        expect(at("SELECT ROW_NUMBER() OVER (ORDER BY |").expectation).toBe(SqlExpectation.Column);
    });
});

describe("analyzeSqlContext — WITH", () => {
    it("names the common table expressions of the statement", () => {
        const context = at("WITH x AS (SELECT 1), y (a) AS MATERIALIZED (SELECT 2) SELECT * FROM |");

        expect(context.expectation).toBe(SqlExpectation.TableName);
        expect(context.cteNames).toEqual(["x", "y"]);
    });

    it("guides the syntax of WITH", () => {
        expect(at("WITH |").keywords).toEqual(["RECURSIVE"]);
        expect(at("WITH x |").keywords).toEqual(["AS"]);
        expect(at("WITH x AS (|").keywords).toEqual(["SELECT", "WITH"]);
        expect(at("WITH x AS (SELECT 1) |").keywords).toEqual(["SELECT", "INSERT INTO", "UPDATE", "DELETE FROM"]);
    });

    it("uses the verb after the CTEs as the statement head", () => {
        expect(at("WITH x AS (SELECT 1) DELETE FROM t |").keywords).toEqual(["WHERE", "RETURNING", "USING"]);
    });
});

describe("analyzeSqlContext — INSERT", () => {
    it("guides INSERT up to its target", () => {
        expect(at("INSERT |").keywords).toEqual(["INTO", "OR REPLACE", "OR IGNORE", "IGNORE"]);
        expect(at("INSERT OR REPLACE |").keywords).toEqual(["INTO"]);
        expect(at("REPLACE |").keywords).toEqual(["INTO"]);
        expect(at("INSERT INTO |").expectation).toBe(SqlExpectation.TableName);
    });

    it("expects the target columns in the column list", () => {
        const first = at("INSERT INTO users (|");
        const next = at("INSERT INTO users (id, |");

        expect(first.expectation).toBe(SqlExpectation.ColumnList);
        expect(first.target).toBe("users");
        expect(next.target).toBe("users");
        expect(at("INSERT INTO users (id |").expectation).toBe(SqlExpectation.None);
    });

    it("expects VALUES or SELECT after the target", () => {
        expect(at("INSERT INTO users |").keywords).toEqual(["VALUES", "SELECT", "DEFAULT VALUES"]);
        expect(at("INSERT INTO users (id) |").keywords).toEqual(["VALUES", "SELECT", "DEFAULT VALUES"]);
    });

    it("expects values in every tuple", () => {
        expect(at("INSERT INTO users VALUES (|").expectation).toBe(SqlExpectation.Value);
        expect(at("INSERT INTO users VALUES (1, |").expectation).toBe(SqlExpectation.Value);
        expect(at("INSERT INTO users VALUES (1), (|").expectation).toBe(SqlExpectation.Value);
        expect(at("INSERT INTO users VALUES (1) |").keywords).toEqual(
            ["ON CONFLICT", "ON DUPLICATE KEY UPDATE", "RETURNING"],
        );
    });

    it("guides an upsert", () => {
        const target = at("INSERT INTO users (id) VALUES (1) ON CONFLICT (|");

        expect(target.expectation).toBe(SqlExpectation.ColumnList);
        expect(target.target).toBe("users");
        expect(at("INSERT INTO users (id) VALUES (1) ON CONFLICT (id) |").keywords).toEqual(
            ["DO NOTHING", "DO UPDATE SET"],
        );
        expect(at("INSERT INTO users (id) VALUES (1) ON CONFLICT (id) DO UPDATE SET |").target).toBe("users");
        expect(at("INSERT INTO users (id) VALUES (1) ON DUPLICATE KEY UPDATE |").target).toBe("users");
    });
});

describe("analyzeSqlContext — UPDATE and DELETE", () => {
    it("guides UPDATE up to SET", () => {
        expect(at("UPDATE |").expectation).toBe(SqlExpectation.TableName);
        expect(at("UPDATE users |").keywords).toEqual(["SET"]);
    });

    it("expects a column of the updated table left of =, an expression right of it", () => {
        const left = at("UPDATE users SET |");

        expect(left.expectation).toBe(SqlExpectation.ColumnList);
        expect(left.target).toBe("users");
        expect(at("UPDATE users SET name |").expectation).toBe(SqlExpectation.None);
        expect(at("UPDATE users SET name = |").expectation).toBe(SqlExpectation.Column);
        expect(at("UPDATE users SET name = 'x' |").keywords).toEqual(["WHERE", "FROM", "RETURNING"]);
        expect(at("UPDATE users SET name = 'x', |").target).toBe("users");
    });

    it("guides DELETE", () => {
        expect(at("DELETE |").keywords).toEqual(["FROM"]);
        expect(at("DELETE FROM |").expectation).toBe(SqlExpectation.TableName);
        expect(at("DELETE FROM users |").keywords).toEqual(["WHERE", "RETURNING", "USING"]);
    });
});

describe("analyzeSqlContext — DDL", () => {
    it("lists the objects that can be created, dropped or altered", () => {
        expect(at("CREATE |").keywords).toEqual(expect.arrayContaining(["TABLE", "VIEW", "INDEX", "UNIQUE INDEX"]));
        expect(at("DROP |").keywords).toEqual(expect.arrayContaining(["TABLE", "VIEW", "INDEX"]));
        expect(at("CREATE UNIQUE |").keywords).toEqual(["INDEX"]);
        expect(at("CREATE OR REPLACE |").keywords).toEqual(expect.arrayContaining(["VIEW"]));
    });

    it("never suggests anything for a name to invent", () => {
        expect(at("CREATE TABLE |").keywords).toEqual(["IF NOT EXISTS"]);
        expect(at("CREATE TABLE t |").expectation).toBe(SqlExpectation.None);
        expect(at("CREATE TABLE t (|").expectation).toBe(SqlExpectation.None);
        expect(at("CREATE TABLE IF NOT EXISTS |").expectation).toBe(SqlExpectation.None);
    });

    it("guides CREATE INDEX", () => {
        expect(at("CREATE INDEX |").expectation).toBe(SqlExpectation.None);
        expect(at("CREATE INDEX idx |").keywords).toEqual(["ON"]);
        expect(at("CREATE INDEX idx ON |").expectation).toBe(SqlExpectation.TableName);

        const columns = at("CREATE INDEX idx ON users (|");

        expect(columns.expectation).toBe(SqlExpectation.ColumnList);
        expect(columns.target).toBe("users");
        expect(at("CREATE VIEW v |").keywords).toEqual(["AS"]);
    });

    it("expects an existing table after DROP TABLE", () => {
        const context = at("DROP TABLE |");

        expect(context.expectation).toBe(SqlExpectation.TableName);
        expect(context.keywords).toEqual(["IF EXISTS"]);
        expect(at("DROP TABLE IF |").keywords).toEqual(["EXISTS", "NOT EXISTS"]);
        expect(at("DROP TABLE IF EXISTS |").expectation).toBe(SqlExpectation.TableName);
    });

    it("guides ALTER TABLE down to the altered column", () => {
        expect(at("ALTER TABLE |").expectation).toBe(SqlExpectation.TableName);
        expect(at("ALTER TABLE users |").keywords).toEqual(expect.arrayContaining(["ADD COLUMN", "DROP COLUMN"]));
        expect(at("ALTER TABLE users DROP |").keywords).toEqual(["COLUMN"]);

        const column = at("ALTER TABLE users DROP COLUMN |");

        expect(column.expectation).toBe(SqlExpectation.ColumnList);
        expect(column.target).toBe("users");
        expect(at("ALTER TABLE users ADD COLUMN |").expectation).toBe(SqlExpectation.None);
    });

    it("expects a table in the SQLite table pragmas and TRUNCATE", () => {
        expect(at("PRAGMA table_info(|").expectation).toBe(SqlExpectation.TableName);
        expect(at("TRUNCATE |").keywords).toEqual(["TABLE"]);
        expect(at("TRUNCATE TABLE |").expectation).toBe(SqlExpectation.TableName);
    });
});

describe("isReservedSqlWord", () => {
    it("recognises reserved words whatever their case, but not common column names", () => {
        expect(isReservedSqlWord("order")).toBe(true);
        expect(isReservedSqlWord("SELECT")).toBe(true);
        expect(isReservedSqlWord("key")).toBe(false);
        expect(isReservedSqlWord("users")).toBe(false);
    });
});
