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

import type { DatabaseDriverType } from "@shared/driver";
import {
    type SqlDialect,
    type SqlIdentifierQuote,
    type SqlSnippet,
    SqlSnippetScope,
} from "src/app/core/models/sql-completion.model";

const DOUBLE_QUOTE: SqlIdentifierQuote = { open: "\"", close: "\"" };
const BACKTICK: SqlIdentifierQuote = { open: "`", close: "`" };
const BRACKETS: SqlIdentifierQuote = { open: "[", close: "]" };

/**
 * Emplacement d'un extrait, noté `{1:table}` (ou `{0}` pour la position
 * finale) plutôt que `${1:table}`, qui passerait pour un gabarit mal écrit.
 */
const PLACEHOLDER = /\{(?<index>\d+)(?::(?<text>[^{}]*))?\}/g;

/** Mots-clés de début d'instruction communs à tous les dialectes. */
const COMMON_STATEMENTS: readonly string[] = [
    "SELECT", "INSERT INTO", "UPDATE", "DELETE FROM", "WITH", "CREATE", "ALTER", "DROP",
];

/** Fonctions communes à tous les dialectes. */
const COMMON_FUNCTIONS: readonly string[] = [
    "COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE", "NULLIF", "LOWER", "UPPER", "TRIM", "ABS", "ROUND", "CAST",
];

/** Fonctions de fenêtrage, connues de tous les dialectes nommés. */
const WINDOW_FUNCTIONS: readonly string[] = ["ROW_NUMBER", "RANK", "DENSE_RANK", "LAG", "LEAD"];

const COMMON_SNIPPETS: readonly SqlSnippet[] = [
    statementSnippet("sel", "SELECT {1:*} FROM {2:table}", "SELECT … FROM …"),
    statementSnippet("selw", "SELECT {1:*} FROM {2:table} WHERE {3:condition}", "SELECT … FROM … WHERE …"),
    statementSnippet("cnt", "SELECT COUNT(*) FROM {1:table}", "SELECT COUNT(*) FROM …"),
    statementSnippet("ins", "INSERT INTO {1:table} ({2:columns}) VALUES ({3:values})", "INSERT INTO … VALUES …"),
    statementSnippet("upd", "UPDATE {1:table} SET {2:column} = {3:value} WHERE {4:condition}", "UPDATE … SET … WHERE …"),
    statementSnippet("del", "DELETE FROM {1:table} WHERE {2:condition}", "DELETE FROM … WHERE …"),
    statementSnippet(
        "cte",
        lines("WITH {1:name} AS (", "\t{2:SELECT 1}", ")", "SELECT * FROM {1:name}"),
        "WITH … AS (…) SELECT …",
    ),
    statementSnippet(
        "ct",
        lines("CREATE TABLE {1:name} (", "\t{2:id} {3:INTEGER} PRIMARY KEY,", "\t{0}", ")"),
        "CREATE TABLE … (…)",
    ),
    statementSnippet("ci", "CREATE INDEX {1:name} ON {2:table} ({3:column})", "CREATE INDEX … ON … (…)"),
    createSnippet(SqlSnippetScope.Join, "ij", "INNER JOIN {1:table} ON {2:condition}", "INNER JOIN … ON …"),
    createSnippet(SqlSnippetScope.Join, "lj", "LEFT JOIN {1:table} ON {2:condition}", "LEFT JOIN … ON …"),
    createSnippet(
        SqlSnippetScope.Expression,
        "case",
        "CASE WHEN {1:condition} THEN {2:value} ELSE {3:value} END",
        "CASE WHEN … THEN … END",
    ),
];

const LIMIT_SNIPPET = statementSnippet("sell", "SELECT {1:*} FROM {2:table} LIMIT {3:100}", "SELECT … FROM … LIMIT 100");

const SQLITE: SqlDialect = {
    specificKeywords: new Set([
        "LIMIT", "OFFSET", "GLOB", "RETURNING", "NULLS FIRST", "NULLS LAST", "ON CONFLICT", "DO NOTHING",
        "DO UPDATE SET", "NOTHING", "UPDATE SET", "OR REPLACE", "OR IGNORE", "IF EXISTS", "IF NOT EXISTS",
        "TEMPORARY TABLE", "VIRTUAL TABLE", "EXCEPT", "RECURSIVE", "TRUE", "FALSE", "DISTINCT FROM", "FULL JOIN",
        "NATURAL JOIN", "USING", "DEFAULT VALUES", "ADD COLUMN", "RENAME TO", "RENAME COLUMN", "PLAN",
    ]),
    statementKeywords: [
        ...COMMON_STATEMENTS, "REPLACE INTO", "PRAGMA", "EXPLAIN QUERY PLAN", "VACUUM", "ANALYZE", "REINDEX",
    ],
    functions: [
        ...COMMON_FUNCTIONS, ...WINDOW_FUNCTIONS, "CHAR", "CHANGES", "DATE", "DATETIME", "FORMAT", "GROUP_CONCAT",
        "HEX", "IFNULL", "IIF", "INSTR", "JSON", "JSON_ARRAY", "JSON_EXTRACT", "JSON_OBJECT", "JULIANDAY",
        "LAST_INSERT_ROWID", "LENGTH", "LTRIM", "PRINTF", "QUOTE", "RANDOM", "REPLACE", "RTRIM", "STRFTIME", "SUBSTR",
        "TIME", "TOTAL", "TYPEOF", "UNICODE", "UNIXEPOCH",
    ],
    snippets: [
        ...COMMON_SNIPPETS,
        LIMIT_SNIPPET,
        statementSnippet("pragma", "PRAGMA table_info({1:table})", "PRAGMA table_info(…)"),
        statementSnippet(
            "ups",
            lines(
                "INSERT INTO {1:table} ({2:columns}) VALUES ({3:values})",
                "ON CONFLICT ({4:key}) DO UPDATE SET {5:column} = excluded.{5:column}",
            ),
            "INSERT … ON CONFLICT DO UPDATE",
        ),
    ],
    identifierQuote: DOUBLE_QUOTE,
    implicitStatementSeparator: false,
};

const MYSQL: SqlDialect = {
    specificKeywords: new Set([
        "LIMIT", "OFFSET", "REGEXP", "IGNORE", "ON DUPLICATE KEY UPDATE", "WITH ROLLUP", "ROLLUP", "IF EXISTS",
        "IF NOT EXISTS", "TEMPORARY TABLE", "PROCEDURE", "FUNCTION", "SCHEMA", "DATABASE", "EXCEPT", "RECURSIVE",
        "TRUE", "FALSE", "NATURAL JOIN", "USING", "DEFAULT", "ADD COLUMN", "MODIFY", "RENAME TO", "RENAME COLUMN",
    ]),
    statementKeywords: [...COMMON_STATEMENTS, "REPLACE INTO", "TRUNCATE TABLE", "SHOW", "DESCRIBE", "EXPLAIN"],
    functions: [
        ...COMMON_FUNCTIONS, ...WINDOW_FUNCTIONS, "CEIL", "CHAR_LENGTH", "CONCAT", "CONCAT_WS", "CONVERT", "CURDATE",
        "CURTIME", "DATE_ADD", "DATE_FORMAT", "DATE_SUB", "DATEDIFF", "DAY", "FIND_IN_SET", "FLOOR", "FROM_UNIXTIME",
        "GROUP_CONCAT", "IF", "IFNULL", "JSON_ARRAY", "JSON_EXTRACT", "JSON_OBJECT", "LAST_INSERT_ID", "LEFT",
        "LENGTH", "LPAD", "MONTH", "NOW", "RAND", "REPLACE", "RIGHT", "RPAD", "SUBSTRING", "SUBSTRING_INDEX",
        "UNIX_TIMESTAMP", "UUID", "YEAR",
    ],
    snippets: [
        ...COMMON_SNIPPETS,
        LIMIT_SNIPPET,
        statementSnippet("desc", "DESCRIBE {1:table}", "DESCRIBE …"),
        statementSnippet(
            "ups",
            lines(
                "INSERT INTO {1:table} ({2:columns}) VALUES ({3:values})",
                "ON DUPLICATE KEY UPDATE {4:column} = VALUES({4:column})",
            ),
            "INSERT … ON DUPLICATE KEY UPDATE",
        ),
    ],
    identifierQuote: BACKTICK,
    implicitStatementSeparator: false,
};

const POSTGRESQL: SqlDialect = {
    specificKeywords: new Set([
        "LIMIT", "OFFSET", "ILIKE", "RETURNING", "NULLS FIRST", "NULLS LAST", "FETCH FIRST", "ON CONFLICT",
        "DO NOTHING", "DO UPDATE SET", "NOTHING", "UPDATE SET", "IF EXISTS", "IF NOT EXISTS", "TEMPORARY TABLE",
        "MATERIALIZED VIEW", "PROCEDURE", "FUNCTION", "SEQUENCE", "SCHEMA", "DATABASE", "EXCEPT", "RECURSIVE", "TRUE",
        "FALSE", "DISTINCT FROM", "FULL JOIN", "NATURAL JOIN", "USING", "DEFAULT", "DEFAULT VALUES", "CASCADE",
        "ADD COLUMN", "ALTER COLUMN", "RENAME TO", "RENAME COLUMN",
    ]),
    statementKeywords: [...COMMON_STATEMENTS, "TRUNCATE TABLE", "EXPLAIN", "VACUUM", "ANALYZE"],
    functions: [
        ...COMMON_FUNCTIONS, ...WINDOW_FUNCTIONS, "AGE", "ARRAY_AGG", "CEIL", "CONCAT", "CONCAT_WS", "DATE_TRUNC",
        "EXTRACT", "FLOOR", "GEN_RANDOM_UUID", "GENERATE_SERIES", "GREATEST", "JSON_AGG", "JSON_BUILD_OBJECT",
        "JSONB_BUILD_OBJECT", "LEAST", "LENGTH", "NOW", "REGEXP_REPLACE", "REPLACE", "SPLIT_PART", "STRING_AGG",
        "SUBSTRING", "TO_CHAR", "TO_DATE", "TO_TIMESTAMP", "UNNEST",
    ],
    snippets: [
        ...COMMON_SNIPPETS,
        LIMIT_SNIPPET,
        statementSnippet(
            "ups",
            lines(
                "INSERT INTO {1:table} ({2:columns}) VALUES ({3:values})",
                "ON CONFLICT ({4:key}) DO UPDATE SET {5:column} = EXCLUDED.{5:column}",
            ),
            "INSERT … ON CONFLICT DO UPDATE",
        ),
    ],
    identifierQuote: DOUBLE_QUOTE,
    implicitStatementSeparator: false,
};

const ORACLE: SqlDialect = {
    specificKeywords: new Set([
        "OFFSET", "NULLS FIRST", "NULLS LAST", "FETCH FIRST", "MINUS", "MATERIALIZED VIEW", "PROCEDURE", "FUNCTION",
        "SEQUENCE", "FULL JOIN", "NATURAL JOIN", "USING", "APPLY", "CROSS APPLY", "OUTER APPLY", "DEFAULT", "MODIFY",
        "RENAME TO", "RENAME COLUMN",
    ]),
    statementKeywords: [...COMMON_STATEMENTS, "TRUNCATE TABLE", "MERGE INTO"],
    functions: [
        ...COMMON_FUNCTIONS, ...WINDOW_FUNCTIONS, "ADD_MONTHS", "CEIL", "DECODE", "EXTRACT", "FLOOR", "INITCAP",
        "INSTR", "LAST_DAY", "LENGTH", "LISTAGG", "LPAD", "LTRIM", "MOD", "MONTHS_BETWEEN", "NVL", "NVL2",
        "REGEXP_LIKE", "REGEXP_REPLACE", "REGEXP_SUBSTR", "REPLACE", "RPAD", "RTRIM", "SUBSTR", "SYSDATE",
        "SYSTIMESTAMP", "TO_CHAR", "TO_DATE", "TO_NUMBER", "TRUNC",
    ],
    snippets: [
        ...COMMON_SNIPPETS,
        statementSnippet(
            "sell",
            "SELECT {1:*} FROM {2:table} FETCH FIRST {3:100} ROWS ONLY",
            "SELECT … FETCH FIRST 100 ROWS ONLY",
        ),
        statementSnippet("dual", "SELECT {1:SYSDATE} FROM DUAL", "SELECT … FROM DUAL"),
    ],
    identifierQuote: DOUBLE_QUOTE,
    implicitStatementSeparator: false,
};

const TRANSACT_SQL: SqlDialect = {
    specificKeywords: new Set([
        "TOP", "OFFSET", "APPLY", "CROSS APPLY", "OUTER APPLY", "WITH ROLLUP", "ROLLUP", "IF EXISTS", "PROCEDURE",
        "FUNCTION", "SEQUENCE", "SCHEMA", "DATABASE", "EXCEPT", "DISTINCT FROM", "FULL JOIN", "DEFAULT",
        "DEFAULT VALUES", "ALTER COLUMN",
    ]),
    statementKeywords: [...COMMON_STATEMENTS, "TRUNCATE TABLE", "MERGE INTO", "EXEC", "DECLARE"],
    functions: [
        ...COMMON_FUNCTIONS, ...WINDOW_FUNCTIONS, "CEILING", "CHARINDEX", "CONCAT", "CONCAT_WS", "CONVERT",
        "COUNT_BIG", "DATEADD", "DATEDIFF", "DATENAME", "DATEPART", "FLOOR", "FORMAT", "GETDATE", "GETUTCDATE", "IIF",
        "ISNULL", "JSON_QUERY", "JSON_VALUE", "LEFT", "LEN", "LTRIM", "NEWID", "OBJECT_ID", "REPLACE", "RIGHT",
        "RTRIM", "SCOPE_IDENTITY", "STRING_AGG", "SUBSTRING", "SYSDATETIME", "TRY_CAST", "TRY_CONVERT",
    ],
    snippets: [
        ...COMMON_SNIPPETS,
        statementSnippet("top", "SELECT TOP {1:100} {2:*} FROM {3:table}", "SELECT TOP 100 … FROM …"),
    ],
    identifierQuote: BRACKETS,
    // Un corps de procédure enchaîne ses instructions sans `;`.
    implicitStatementSeparator: true,
};

/** SQL générique, pour un moteur inconnu : aucun mot-clé propre. */
const GENERIC: SqlDialect = {
    specificKeywords: new Set(),
    statementKeywords: COMMON_STATEMENTS,
    functions: COMMON_FUNCTIONS,
    snippets: COMMON_SNIPPETS,
    identifierQuote: DOUBLE_QUOTE,
    implicitStatementSeparator: false,
};

const DIALECTS: ReadonlyMap<DatabaseDriverType, SqlDialect> = new Map([
    ["sqlite", SQLITE],
    ["libsql", SQLITE],
    ["mysql", MYSQL],
    ["postgresql", POSTGRESQL],
    ["oracle", ORACLE],
    ["mssql", TRANSACT_SQL],
    ["azure", TRANSACT_SQL],
]);

/** Mots-clés que tous les dialectes ne connaissent pas. */
const SPECIFIC_KEYWORDS: ReadonlySet<string> = new Set(
    [SQLITE, MYSQL, POSTGRESQL, ORACLE, TRANSACT_SQL].flatMap(dialect => [...dialect.specificKeywords]),
);

/**
 * Extrait au format des snippets Monaco, à partir de la notation `{1:table}`.
 */
function createSnippet(scope: SqlSnippetScope, prefix: string, body: string, description: string): SqlSnippet {
    const monacoBody = body.replace(PLACEHOLDER, (_match: string, index: string, text: string | undefined) => {
        return text === undefined ? `$${index}` : `\${${index}:${text}}`;
    });

    return { prefix, body: monacoBody, description, scope };
}

/**
 * Extrait proposé en début d'instruction.
 */
function statementSnippet(prefix: string, body: string, description: string): SqlSnippet {
    return createSnippet(SqlSnippetScope.Statement, prefix, body, description);
}

/**
 * Corps d'extrait sur plusieurs lignes.
 */
function lines(...parts: string[]): string {
    return parts.join("\n");
}

/**
 * @description Dialecte SQL du moteur connecté. MongoDB, sans SQL, et l'absence
 * de connexion retombent sur le SQL générique.
 *
 * @param driverType - Moteur de la connexion active.
 * @returns Le vocabulaire du dialecte.
 *
 * @example
 * resolveSqlDialect("azure") === resolveSqlDialect("mssql"); // true : T-SQL
 */
export function resolveSqlDialect(driverType: DatabaseDriverType | null): SqlDialect {
    return (driverType && DIALECTS.get(driverType)) ?? GENERIC;
}

/**
 * @description Indique si un mot-clé existe dans un dialecte. Un mot-clé
 * qu'aucun dialecte ne déclare comme propre est commun à tous.
 *
 * @param dialect - Dialecte visé.
 * @param keyword - Mot-clé en majuscules (`LIMIT`, `GROUP BY`).
 * @returns `false` pour `LIMIT` en T-SQL, `true` pour `WHERE` partout.
 */
export function isKeywordSupported(dialect: SqlDialect, keyword: string): boolean {
    return !SPECIFIC_KEYWORDS.has(keyword) || dialect.specificKeywords.has(keyword);
}
