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

import {
    type SqlCompletionContext,
    SqlExpectation,
    type SqlIdentifierToken,
    type SqlPositionResolution,
    SqlReferenceSource,
    type SqlResolutionInput,
    type SqlTableReference,
    type SqlToken,
    SqlTokenKind,
} from "src/app/core/models/sql-completion.model";
import { tokenizeSql } from "src/app/shared/helpers/sql-tokenizer.helper";

/**
 * Mots réservés : ils ne servent ni d'alias ni d'opérande sans être délimités.
 * Les mots souvent employés comme noms de colonne (`key`, `first`, `last`,
 * `index`, `to`…) en sont volontairement exclus : les prendre pour des
 * mots-clés fausserait l'analyse de requêtes parfaitement valides.
 */
const RESERVED_WORDS: ReadonlySet<string> = new Set([
    "ADD", "ALL", "ALTER", "AND", "ANY", "APPLY", "AS", "ASC", "BEGIN", "BETWEEN", "BY", "CASCADE", "CASE", "CHECK",
    "COLLATE", "CONSTRAINT", "CREATE", "CROSS", "DECLARE", "DEFAULT", "DELETE", "DESC", "DESCRIBE", "DISTINCT", "DROP",
    "ELSE", "END", "ESCAPE", "EXCEPT", "EXEC", "EXISTS", "EXPLAIN", "FALSE", "FETCH", "FOREIGN", "FROM", "FULL",
    "GLOB", "GO", "GROUP", "HAVING", "IF", "ILIKE", "IN", "INNER", "INSERT", "INTERSECT", "INTO", "IS", "JOIN",
    "LATERAL", "LEFT", "LIKE", "LIMIT", "MERGE", "MINUS", "NATURAL", "NOT", "NULL", "OFFSET", "ON", "OR", "ORDER",
    "OUTER", "OVER", "PARTITION", "PRAGMA", "PRIMARY", "PRINT", "RECURSIVE", "REFERENCES", "REGEXP", "RENAME",
    "REPLACE", "RETURNING", "RIGHT", "SELECT", "SET", "SHOW", "TABLE", "THEN", "TOP", "TRUE", "TRUNCATE", "UNION",
    "UNIQUE", "UPDATE", "USING", "VALUES", "WHEN", "WHERE", "WINDOW", "WITH",
]);

/** Mots réservés qui terminent un opérande. */
const TERM_END_WORDS: ReadonlySet<string> = new Set(["NULL", "TRUE", "FALSE", "END", "ASC", "DESC"]);

/** Mots-clés qui introduisent une clause : le dernier rencontré détermine ce qu'attend le curseur. */
const CLAUSE_WORDS: ReadonlySet<string> = new Set([
    "SELECT", "FROM", "JOIN", "WHERE", "ON", "USING", "BY", "HAVING", "LIMIT", "INTO", "VALUES", "SET", "UPDATE",
    "DELETE", "INSERT", "REPLACE", "TABLE", "RETURNING", "WITH", "CREATE", "ALTER", "DROP", "TRUNCATE", "DESCRIBE",
    "SHOW", "PRAGMA", "BEGIN",
]);

/** Mots-clés qui sont aussi des fonctions (`REPLACE(…)`) quand une parenthèse les suit. */
const FUNCTION_LIKE_WORDS: ReadonlySet<string> = new Set(["REPLACE", "INSERT", "TRUNCATE"]);

/** Verbes qui donnent sa nature à une instruction. */
const STATEMENT_VERBS: ReadonlySet<string> = new Set([
    "SELECT", "INSERT", "REPLACE", "UPDATE", "DELETE", "CREATE", "ALTER", "DROP", "TRUNCATE", "PRAGMA", "SHOW",
    "DESCRIBE", "MERGE", "EXEC", "DECLARE",
]);

/** Clauses suivies d'un nom de table. */
const TABLE_CLAUSES: ReadonlySet<string> = new Set(["FROM", "JOIN", "UPDATE", "INTO", "TABLE", "DESCRIBE"]);

/** Clauses qui font entrer une table dans la portée de la requête. */
const REFERENCE_SOURCES: ReadonlyMap<string, SqlReferenceSource> = new Map([
    ["FROM", SqlReferenceSource.From],
    ["JOIN", SqlReferenceSource.Join],
    ["UPDATE", SqlReferenceSource.Update],
    ["INTO", SqlReferenceSource.Into],
    ["TABLE", SqlReferenceSource.Table],
    ["DESCRIBE", SqlReferenceSource.Table],
]);

/** Mots qui peuvent précéder un nom de table sans en être un (`IF EXISTS`, `ONLY`, `LATERAL`). */
const TABLE_PREFIX_WORDS: ReadonlySet<string> = new Set(["IF", "NOT", "EXISTS", "ONLY", "LATERAL"]);

const JOIN_KEYWORDS: readonly string[] = [
    "JOIN", "INNER JOIN", "LEFT JOIN", "RIGHT JOIN", "FULL JOIN", "CROSS JOIN", "NATURAL JOIN", "CROSS APPLY",
    "OUTER APPLY",
];
const SET_OPERATORS: readonly string[] = ["UNION", "UNION ALL", "INTERSECT", "EXCEPT", "MINUS"];
const PREDICATE_KEYWORDS: readonly string[] = ["AND", "OR", "NOT", "IS", "IN", "LIKE", "ILIKE", "GLOB", "REGEXP", "BETWEEN"];
const EXPRESSION_KEYWORDS: readonly string[] = ["NOT", "EXISTS", "CASE", "NULL"];
const SELECT_START_KEYWORDS: readonly string[] = ["DISTINCT", "TOP", "CASE"];
const VALUE_KEYWORDS: readonly string[] = ["NULL", "DEFAULT", "CURRENT_TIMESTAMP", "CURRENT_DATE", "TRUE", "FALSE"];
const CASE_KEYWORDS: readonly string[] = ["WHEN", "THEN", "ELSE", "END"];
const CREATE_TARGETS: readonly string[] = [
    "TABLE", "VIEW", "INDEX", "UNIQUE INDEX", "TRIGGER", "TEMPORARY TABLE", "VIRTUAL TABLE", "MATERIALIZED VIEW",
    "PROCEDURE", "FUNCTION", "SEQUENCE", "SCHEMA", "DATABASE",
];
const OBJECT_TARGETS: readonly string[] = [
    "TABLE", "VIEW", "INDEX", "TRIGGER", "MATERIALIZED VIEW", "PROCEDURE", "FUNCTION", "SEQUENCE", "SCHEMA",
    "DATABASE",
];
const SHOW_TARGETS: readonly string[] = [
    "TABLES", "COLUMNS FROM", "INDEX FROM", "CREATE TABLE", "DATABASES", "PROCESSLIST", "VARIABLES", "STATUS",
];
const ALTER_TABLE_ACTIONS: readonly string[] = [
    "ADD", "ADD COLUMN", "DROP COLUMN", "ALTER COLUMN", "MODIFY", "RENAME TO", "RENAME COLUMN",
];
const ORDER_BY_FOLLOW: readonly string[] = ["ASC", "DESC", "NULLS FIRST", "NULLS LAST", "LIMIT", "OFFSET", "FETCH FIRST"];
const STATEMENT_AFTER_CTE: readonly string[] = ["SELECT", "INSERT INTO", "UPDATE", "DELETE FROM"];
const SUBQUERY_START: readonly string[] = ["SELECT", "WITH"];

/**
 * @description Indique si un mot est réservé et doit être délimité pour servir
 * d'identifiant.
 *
 * @param word - Mot à tester, quelle que soit sa casse.
 * @returns `true` pour `order`, `select`… ; `false` pour `users`, `key`.
 */
export function isReservedSqlWord(word: string): boolean {
    return RESERVED_WORDS.has(word.toUpperCase());
}

/**
 * @description Analyse la position du curseur dans un texte SQL : clause en
 * cours, tables en portée, alias, mot en cours de frappe. L'analyse est
 * tolérante aux requêtes incomplètes ou invalides — l'état normal pendant la
 * frappe — et ne dépend d'aucun dialecte.
 *
 * Seule l'instruction du curseur (bornée par des `;`) est analysée. Entre
 * parenthèses, seule compte la requête englobante la plus proche ; les tables
 * des requêtes plus externes restent accessibles par leur qualificatif
 * (sous-requêtes corrélées).
 *
 * @param text - Contenu complet de l'éditeur.
 * @param offset - Décalage du curseur dans `text`.
 * @returns Le contexte, `SqlExpectation.None` dans une chaîne, un commentaire,
 * un identifiant délimité ou un nombre.
 *
 * @example
 * analyzeSqlContext("SELECT * FROM us", 16).expectation; // SqlExpectation.TableName
 */
export function analyzeSqlContext(text: string, offset: number): SqlCompletionContext {
    let prefixStart = offset;
    const significant: SqlToken[] = [];

    for (const token of tokenizeSql(text)) {
        const touchesCursor = token.start < offset && offset <= token.end;

        if (token.kind === SqlTokenKind.Word && touchesCursor) {
            // Le mot en cours de frappe est retiré : partiel, il fausserait l'analyse.
            prefixStart = token.start;
            continue;
        }

        if (isInsideLiteral(token, offset) || (token.kind === SqlTokenKind.Number && touchesCursor)) {
            return emptyContext(offset);
        }

        if (token.kind !== SqlTokenKind.Comment) {
            significant.push(token);
        }
    }

    const statement = currentStatement(significant, prefixStart);
    const cursorIndex = countTokensBefore(statement, prefixStart);
    const { parents, openAtCursor } = computeParents(statement, cursorIndex);
    const innermost = openAtCursor.at(-1) ?? -1;
    const levels = [...openAtCursor].reverse();

    levels.push(-1);

    const topLevel = tokensAtLevel(statement, parents, -1, statement.length);
    const head = findStatementHead(topLevel);
    const scope = collectScope(statement, parents, levels, head);

    const resolution = resolvePosition({
        before: tokensAtLevel(statement, parents, innermost, cursorIndex),
        insideParens: innermost >= 0,
        opener: statement[innermost - 1],
        openerPrevious: statement[innermost - 2],
        enclosingClause: findEnclosingClause(statement, parents, innermost),
        head,
        scope,
    });

    return {
        ...resolution,
        prefix: text.slice(prefixStart, offset),
        prefixStart,
        scope,
        cteNames: collectCteNames(topLevel),
    };
}

/**
 * Contexte sans suggestion.
 */
function emptyContext(offset: number): SqlCompletionContext {
    return { ...NONE, prefix: "", prefixStart: offset, scope: [], cteNames: [] };
}

/**
 * Le curseur est à l'intérieur d'une chaîne, d'un identifiant délimité ou d'un
 * commentaire. Juste après le délimiteur fermant, il en est sorti.
 */
function isInsideLiteral(token: SqlToken, offset: number): boolean {
    const isLiteral = token.kind === SqlTokenKind.String
        || token.kind === SqlTokenKind.QuotedIdentifier
        || token.kind === SqlTokenKind.Comment;

    if (!isLiteral || offset <= token.start) {
        return false;
    }

    return offset < token.end || (offset === token.end && !token.terminated);
}

/**
 * Jetons de l'instruction du curseur, entre les `;` qui l'entourent.
 */
function currentStatement(tokens: readonly SqlToken[], prefixStart: number): SqlToken[] {
    let first = 0;
    let last = tokens.length;

    for (const [index, token] of tokens.entries()) {
        if (token.text !== ";") {
            continue;
        }

        if (token.start < prefixStart) {
            first = index + 1;
        }
        else {
            last = index;
            break;
        }
    }

    return tokens.slice(first, last);
}

/**
 * Nombre de jetons qui précèdent le mot en cours de frappe.
 */
function countTokensBefore(tokens: readonly SqlToken[], prefixStart: number): number {
    let count = 0;

    while (count < tokens.length && (tokens[count]?.start ?? prefixStart) < prefixStart) {
        count++;
    }

    return count;
}

/**
 * Parenthèse ouvrante qui contient chaque jeton (`-1` au niveau de
 * l'instruction) et parenthèses encore ouvertes à la position du curseur, de
 * la plus externe à la plus interne. Une parenthèse fermante appartient au
 * niveau de son ouvrante.
 */
function computeParents(tokens: readonly SqlToken[], cursorIndex: number): { parents: number[]; openAtCursor: number[] } {
    const parents: number[] = [];
    const stack: number[] = [];
    let openAtCursor: number[] = [];

    for (const [index, token] of tokens.entries()) {
        if (index === cursorIndex) {
            openAtCursor = [...stack];
        }

        if (token.text === ")") {
            stack.pop();
        }

        parents.push(stack.at(-1) ?? -1);

        if (token.text === "(") {
            stack.push(index);
        }
    }

    if (cursorIndex >= tokens.length) {
        openAtCursor = [...stack];
    }

    return { parents, openAtCursor };
}

/**
 * Jetons d'un niveau de parenthèses, parmi les `end` premiers.
 */
function tokensAtLevel(tokens: readonly SqlToken[], parents: readonly number[], level: number, end: number): SqlToken[] {
    return tokens.slice(0, end).filter((_, index) => parents[index] === level);
}

/**
 * Clause du niveau qui contient la parenthèse ouvrante du curseur.
 */
function findEnclosingClause(tokens: readonly SqlToken[], parents: readonly number[], innermost: number): string | null {
    if (innermost < 0) {
        return null;
    }

    const enclosing = tokensAtLevel(tokens, parents, parents[innermost] ?? -1, innermost);
    const clause = enclosing[findClauseIndex(enclosing)];

    return clause?.upper ?? null;
}

/**
 * Premier verbe de l'instruction, hors requêtes nommées (`WITH x AS (…) DELETE`).
 */
function findStatementHead(topLevel: readonly SqlToken[]): string | null {
    const verb = topLevel.find(token => token.kind === SqlTokenKind.Word && STATEMENT_VERBS.has(token.upper));

    return verb?.upper ?? null;
}

/**
 * Mot-clé d'un jeton, en majuscules, `null` s'il ne s'agit pas d'un mot.
 */
function wordOf(token: SqlToken | undefined): string | null {
    return token?.kind === SqlTokenKind.Word ? token.upper : null;
}

/**
 * Le jeton peut désigner une table, une colonne ou un alias.
 */
function isIdentifier(token: SqlToken | undefined): token is SqlIdentifierToken {
    if (!token) {
        return false;
    }

    if (token.kind === SqlTokenKind.QuotedIdentifier) {
        return true;
    }

    return token.kind === SqlTokenKind.Word && !RESERVED_WORDS.has(token.upper);
}

/**
 * Le jeton termine un opérande : ce qui suit est un opérateur ou une clause,
 * pas une nouvelle valeur.
 */
function isTermEnd(token: SqlToken, previous: SqlToken | undefined): boolean {
    switch (token.kind) {
        case SqlTokenKind.QuotedIdentifier:
        case SqlTokenKind.String:
        case SqlTokenKind.Number:
            return true;
        case SqlTokenKind.Word:
            return TERM_END_WORDS.has(token.upper) || !RESERVED_WORDS.has(token.upper);
        case SqlTokenKind.Punctuation:
            return token.text === ")" || token.text === "?" || (token.text === "*" && isStarOperand(previous));
        default:
            return false;
    }
}

/**
 * `*` est l'opérande « toutes les colonnes » (et non une multiplication).
 */
function isStarOperand(previous: SqlToken | undefined): boolean {
    if (!previous || previous.text === "," || previous.text === "." || previous.text === "(") {
        return true;
    }

    return previous.upper === "SELECT" || previous.upper === "DISTINCT" || previous.upper === "ALL";
}

/**
 * Mots-clés de `CASE` si une expression `CASE` est encore ouverte.
 */
function openCaseKeywords(tokens: readonly SqlToken[]): readonly string[] {
    let depth = 0;

    for (const token of tokens) {
        if (token.kind !== SqlTokenKind.Word) {
            continue;
        }

        if (token.upper === "CASE") {
            depth++;
        }
        else if (token.upper === "END" && depth > 0) {
            depth--;
        }
    }

    return depth > 0 ? CASE_KEYWORDS : [];
}

/**
 * Indice de la dernière clause, `-1` s'il n'y en a pas.
 */
function findClauseIndex(tokens: readonly SqlToken[]): number {
    for (let index = tokens.length - 1; index >= 0; index--) {
        const word = wordOf(tokens[index]);

        if (word === null || !CLAUSE_WORDS.has(word)) {
            continue;
        }

        if (!isClauseOccurrence(tokens, index, word)) {
            continue;
        }

        return index;
    }

    return -1;
}

/**
 * Écarte les mots de clause employés autrement : `REPLACE(…)` est une fonction,
 * `IS DISTINCT FROM` un opérateur.
 */
function isClauseOccurrence(tokens: readonly SqlToken[], index: number, word: string): boolean {
    if (FUNCTION_LIKE_WORDS.has(word) && tokens[index + 1]?.text === "(") {
        return false;
    }

    return word !== "FROM" || wordOf(tokens[index - 1]) !== "DISTINCT";
}

// --- Portée ---

/**
 * Tables en portée, du niveau du curseur vers l'instruction. Seule une
 * sous-requête (un niveau qui a son propre `SELECT`) isole sa portée : les
 * parenthèses d'une fonction ou d'une liste (`COUNT(`, `IN (1, 2`,
 * `ON CONFLICT (`) voient les tables de la requête qui les contient.
 */
function collectScope(
    statement: readonly SqlToken[],
    parents: readonly number[],
    levels: readonly number[],
    head: string | null,
): SqlTableReference[] {
    const scope: SqlTableReference[] = [];
    let outer = false;

    for (const level of levels) {
        const block = tokensAtLevel(statement, parents, level, statement.length);

        scope.push(...collectReferences(block, outer, head));

        if (block.some(token => token.kind === SqlTokenKind.Word && token.upper === "SELECT")) {
            outer = true;
        }
    }

    return scope;
}

/**
 * Tables introduites par les clauses d'un niveau de requête.
 */
function collectReferences(block: readonly SqlToken[], outer: boolean, head: string | null): SqlTableReference[] {
    const references: SqlTableReference[] = [];
    let index = 0;

    while (index < block.length) {
        const source = referenceSource(block, index, head);

        index++;

        if (source !== null) {
            index = readReferences(block, index, source, outer, references);
        }
    }

    return references;
}

/**
 * Clause qui fait entrer une table dans la portée, portée par le jeton `index`.
 */
function referenceSource(block: readonly SqlToken[], index: number, head: string | null): SqlReferenceSource | null {
    const word = wordOf(block[index]);

    if (word === null) {
        return null;
    }

    // `CREATE INDEX i ON t`, `CREATE TRIGGER … ON t` ; `CREATE TABLE t` crée une table qui n'existe pas encore.
    if (head === "CREATE") {
        if (word === "ON") {
            return SqlReferenceSource.Table;
        }

        if (word === "TABLE") {
            return null;
        }
    }

    if (!isClauseOccurrence(block, index, word)) {
        return null;
    }

    const source = REFERENCE_SOURCES.get(word) ?? null;
    const previous = wordOf(block[index - 1]);

    // `ON DUPLICATE KEY UPDATE` et `DO UPDATE` modifient la table de l'INSERT.
    if (source === SqlReferenceSource.Update && (previous === "KEY" || previous === "DO")) {
        return null;
    }

    return source;
}

/**
 * Lit les tables qui suivent une clause (`FROM a x, b AS y`, `JOIN c`,
 * `(sous-requête) z`) et renvoie l'indice du premier jeton non lu.
 */
function readReferences(
    block: readonly SqlToken[],
    start: number,
    source: SqlReferenceSource,
    outer: boolean,
    references: SqlTableReference[],
): number {
    let index = start;

    while (index < block.length) {
        while (TABLE_PREFIX_WORDS.has(wordOf(block[index]) ?? "")) {
            index++;
        }

        const token = block[index];
        let table: string | null = null;

        if (token?.text === "(") {
            index = skipParens(block, index);
        }
        else if (isIdentifier(token)) {
            table = token.value;
            index++;

            // `schema.table` : seul le dernier segment désigne la table.
            let segment = block[index + 1];

            while (block[index]?.text === "." && isIdentifier(segment)) {
                table = segment.value;
                index += 2;
                segment = block[index + 1];
            }
        }
        else {
            return index;
        }

        const alias = readAlias(block, index);

        references.push({ table, alias: alias?.value ?? null, source, outer });
        index = alias?.next ?? index;

        if (source !== SqlReferenceSource.From || block[index]?.text !== ",") {
            return index;
        }

        index++;
    }

    return index;
}

/**
 * Alias qui suit une table (`t x`, `t AS x`), avec l'indice du jeton suivant.
 */
function readAlias(block: readonly SqlToken[], index: number): { value: string; next: number } | null {
    const token = block[index];
    const next = block[index + 1];

    if (wordOf(token) === "AS" && isIdentifier(next)) {
        return { value: next.value, next: index + 2 };
    }

    if (isIdentifier(token)) {
        return { value: token.value, next: index + 1 };
    }

    return null;
}

/**
 * Saute une paire de parenthèses : leur contenu, plus profond, n'est pas dans
 * la liste, seules l'ouvrante et la fermante y figurent.
 */
function skipParens(tokens: readonly SqlToken[], index: number): number {
    if (tokens[index]?.text !== "(") {
        return index;
    }

    return tokens[index + 1]?.text === ")" ? index + 2 : index + 1;
}

/**
 * Noms des requêtes nommées d'une instruction `WITH a AS (…), b (x, y) AS (…) …`.
 */
function collectCteNames(topLevel: readonly SqlToken[]): string[] {
    if (wordOf(topLevel[0]) !== "WITH") {
        return [];
    }

    const names: string[] = [];
    let index = wordOf(topLevel[1]) === "RECURSIVE" ? 2 : 1;
    let name = topLevel[index];

    while (isIdentifier(name)) {
        index = skipParens(topLevel, index + 1);

        if (wordOf(topLevel[index]) !== "AS") {
            break;
        }

        names.push(name.value);
        index++;

        // PostgreSQL : `AS [NOT] MATERIALIZED (…)`.
        while (wordOf(topLevel[index]) === "NOT" || wordOf(topLevel[index]) === "MATERIALIZED") {
            index++;
        }

        index = skipParens(topLevel, index);

        if (topLevel[index]?.text !== ",") {
            break;
        }

        index++;
        name = topLevel[index];
    }

    return names;
}

// --- Résolution ---

const NONE: SqlPositionResolution = createResolution(SqlExpectation.None);

/**
 * Résolution par défaut d'une attente, complétée par `overrides`.
 */
function createResolution(expectation: SqlExpectation, overrides: Partial<SqlPositionResolution> = {}): SqlPositionResolution {
    return {
        expectation,
        keywords: [],
        qualifier: null,
        target: null,
        allowStar: false,
        joinSnippets: false,
        ...overrides,
    };
}

function statementStart(): SqlPositionResolution {
    return createResolution(SqlExpectation.StatementStart);
}

function keywords(list: readonly string[], joinSnippets = false): SqlPositionResolution {
    return createResolution(SqlExpectation.Keyword, { keywords: list, joinSnippets });
}

function tables(list: readonly string[] = []): SqlPositionResolution {
    return createResolution(SqlExpectation.TableName, { keywords: list });
}

function columns(list: readonly string[], allowStar = false): SqlPositionResolution {
    return createResolution(SqlExpectation.Column, { keywords: list, allowStar });
}

function columnList(target: string | null): SqlPositionResolution {
    return target === null ? NONE : createResolution(SqlExpectation.ColumnList, { target });
}

function values(): SqlPositionResolution {
    return createResolution(SqlExpectation.Value, { keywords: VALUE_KEYWORDS });
}

/**
 * Opérande attendu, ou opérateur et clauses suivantes après un opérande.
 */
function expression(termEnd: boolean, openCase: readonly string[], follow: readonly string[]): SqlPositionResolution {
    if (!termEnd) {
        return columns(EXPRESSION_KEYWORDS);
    }

    return keywords([...openCase, ...follow]);
}

/**
 * Table visée par une instruction de modification (`UPDATE t`, sinon `INSERT INTO t`).
 */
function modifiedTable(scope: readonly SqlTableReference[]): string | null {
    const local = scope.filter(reference => !reference.outer);
    const update = local.find(reference => reference.source === SqlReferenceSource.Update);
    const into = local.find(reference => reference.source === SqlReferenceSource.Into);

    return (update ?? into)?.table ?? null;
}

/**
 * Point d'entrée de la résolution : ce qu'attend la grammaire après les jetons
 * qui précèdent le curseur.
 */
function resolvePosition(input: SqlResolutionInput): SqlPositionResolution {
    const last = input.before.at(-1);

    if (!last) {
        return input.insideParens ? resolveOpener(input) : statementStart();
    }

    if (last.text === ".") {
        return resolveQualified(input);
    }

    const afterWord = resolveAfterWord(input, last);

    if (afterWord) {
        return afterWord;
    }

    // Les arguments d'une fonction n'ont pas de clause : `EXTRACT(YEAR FROM d)`
    // ne fait pas de `d` une table.
    if (input.insideParens && isIdentifier(input.opener)) {
        return resolveInsideParens(input, last);
    }

    const clauseIndex = findClauseIndex(input.before);
    const clause = input.before[clauseIndex];

    if (!clause) {
        return input.insideParens ? resolveInsideParens(input, last) : NONE;
    }

    return resolveClause(input, clauseIndex, clause, last);
}

/**
 * Après `x.` : colonne de la table ou de l'alias `x`, ou table d'un schéma
 * `x` dans une clause qui attend une table.
 */
function resolveQualified(input: SqlResolutionInput): SqlPositionResolution {
    const { before } = input;
    const owner = before.at(-2);

    if (!isIdentifier(owner)) {
        return NONE;
    }

    const clause = before[findClauseIndex(before)];
    const ownerPrevious = before.at(-3);
    const isTablePosition = ownerPrevious === clause || ownerPrevious?.text === ",";

    if (clause && TABLE_CLAUSES.has(clause.upper) && isTablePosition) {
        return tables();
    }

    return createResolution(SqlExpectation.QualifiedColumn, {
        qualifier: owner.value,
        allowStar: clause?.upper === "SELECT",
    });
}

/**
 * Mots-clés qui fixent à eux seuls la suite (`ORDER` → `BY`, `IS` → `NULL`…).
 * `null` quand la clause doit trancher.
 */
function resolveAfterWord(input: SqlResolutionInput, last: SqlToken): SqlPositionResolution | null {
    if (last.kind !== SqlTokenKind.Word) {
        return null;
    }

    const { before } = input;
    const previous = wordOf(before.at(-2));
    const isFirst = before.length === 1 && !input.insideParens;

    switch (last.upper) {
        case "ORDER":
        case "GROUP":
        case "PARTITION":
            return keywords(["BY"]);
        case "INSERT":
            return keywords(["INTO", "OR REPLACE", "OR IGNORE", "IGNORE"]);
        case "IGNORE":
            return previous === "INSERT" || previous === "OR" ? keywords(["INTO"]) : null;
        case "REPLACE":
            return resolveAfterReplace(before, isFirst);
        case "DELETE":
            return keywords(["FROM"]);
        case "CREATE":
            return keywords(CREATE_TARGETS);
        case "UNIQUE":
            return previous === "CREATE" ? keywords(["INDEX"]) : null;
        case "TEMP":
        case "TEMPORARY":
            return keywords(["TABLE", "VIEW"]);
        case "DROP":
        case "ALTER":
            return isFirst ? keywords(OBJECT_TARGETS) : keywords(["COLUMN"]);
        case "TRUNCATE":
            return keywords(["TABLE"]);
        case "SHOW":
            return keywords(SHOW_TARGETS);
        case "EXPLAIN":
        case "BEGIN":
            return statementStart();
        case "QUERY":
            return previous === "EXPLAIN" ? keywords(["PLAN"]) : null;
        case "PLAN":
            return previous === "QUERY" ? statementStart() : null;
        case "UNION":
            return keywords(["SELECT", "ALL"]);
        case "INTERSECT":
        case "EXCEPT":
        case "MINUS":
            return keywords(["SELECT"]);
        case "ALL":
            return previous === "UNION" ? keywords(["SELECT"]) : null;
        case "LEFT":
        case "RIGHT":
        case "FULL":
            return keywords(["JOIN", "OUTER JOIN"]);
        case "INNER":
        case "NATURAL":
            return keywords(["JOIN"]);
        case "CROSS":
            return keywords(["JOIN", "APPLY"]);
        case "OUTER":
            return previous === "LEFT" || previous === "RIGHT" || previous === "FULL"
                ? keywords(["JOIN"])
                : keywords(["APPLY"]);
        case "IS":
            return keywords(["NULL", "NOT NULL", "NOT", "TRUE", "FALSE", "DISTINCT FROM"]);
        case "NOT":
            return previous === "IS" ? keywords(["NULL", "DISTINCT FROM", "TRUE", "FALSE"]) : null;
        case "IF":
            return keywords(["EXISTS", "NOT EXISTS"]);
        case "EXISTS":
            return resolveAfterExists(before);
        case "COLUMN":
            return resolveAfterColumn(input, previous);
        case "DO":
            return keywords(["NOTHING", "UPDATE SET"]);
        case "WITH":
            return isFirst ? keywords(["RECURSIVE"]) : null;
        case "AS":
        case "RECURSIVE":
        case "TOP":
        case "LIMIT":
        case "OFFSET":
        case "FETCH":
        case "DECLARE":
        case "EXEC":
            return NONE;
        default:
            return null;
    }
}

/**
 * `REPLACE INTO`, `INSERT OR REPLACE INTO`, `CREATE OR REPLACE VIEW`.
 */
function resolveAfterReplace(before: readonly SqlToken[], isFirst: boolean): SqlPositionResolution | null {
    const previous = wordOf(before.at(-2));

    if (previous === "OR" && wordOf(before.at(-3)) === "CREATE") {
        return keywords(CREATE_TARGETS);
    }

    return isFirst || previous === "OR" ? keywords(["INTO"]) : null;
}

/**
 * `DROP TABLE IF EXISTS` attend une table ; `IF NOT EXISTS` un nom à inventer ;
 * `EXISTS` dans une expression, une parenthèse.
 */
function resolveAfterExists(before: readonly SqlToken[]): SqlPositionResolution {
    const previous = wordOf(before.at(-2));

    if (previous === "IF" && wordOf(before.at(-3)) === "TABLE") {
        return tables();
    }

    return NONE;
}

/**
 * `ALTER TABLE t DROP COLUMN` attend une colonne de `t` ; `ADD COLUMN` un nom à inventer.
 */
function resolveAfterColumn(input: SqlResolutionInput, previous: string | null): SqlPositionResolution {
    if (previous !== "DROP" && previous !== "ALTER" && previous !== "RENAME" && previous !== "MODIFY") {
        return NONE;
    }

    const altered = input.scope.find(reference => !reference.outer && reference.source === SqlReferenceSource.Table);

    return columnList(altered?.table ?? null);
}

/**
 * Juste après une parenthèse ouvrante : son rôle dépend de ce qui la précède.
 */
function resolveOpener(input: SqlResolutionInput): SqlPositionResolution {
    const { opener } = input;

    if (!opener) {
        return keywords(SUBQUERY_START);
    }

    if (isIdentifier(opener)) {
        return resolveCallOrTarget(input, opener);
    }

    if (opener.text === ",") {
        // `VALUES (…), (` : un nouveau tuple.
        return input.enclosingClause === "VALUES" ? values() : columns(EXPRESSION_KEYWORDS);
    }

    switch (opener.upper) {
        case "IN":
            return columns(["SELECT"]);
        case "EXISTS":
        case "AS":
        case "FROM":
        case "JOIN":
        case "UNION":
        case "ALL":
        case "INTERSECT":
        case "EXCEPT":
        case "MINUS":
        case "LATERAL":
        case "APPLY":
            return keywords(SUBQUERY_START);
        case "VALUES":
            return values();
        case "OVER":
            return keywords(["PARTITION BY", "ORDER BY"]);
        case "INTO":
        case "TABLE":
            return NONE;
        default:
            return columns(["SELECT", ...EXPRESSION_KEYWORDS]);
    }
}

/**
 * Parenthèse qui suit un identifiant : liste de colonnes d'une table
 * (`INSERT INTO t (`, `CREATE INDEX i ON t (`), définition d'une table créée,
 * ou appel de fonction.
 */
function resolveCallOrTarget(input: SqlResolutionInput, opener: SqlToken): SqlPositionResolution {
    const previous = wordOf(input.openerPrevious);

    if (previous === "INTO") {
        return columnList(opener.value);
    }

    if (input.head === "CREATE") {
        if (previous === "ON") {
            return columnList(opener.value);
        }

        if (previous === "TABLE" || previous === "VIEW" || previous === "EXISTS") {
            return NONE;
        }
    }

    if (previous === "PRAGMA") {
        return tables();
    }

    if (opener.upper === "CONFLICT") {
        return columnList(modifiedTable(input.scope));
    }

    if (opener.upper === "COUNT") {
        return columns(["DISTINCT"], true);
    }

    return columns(["DISTINCT", "CASE"]);
}

/**
 * Entre parenthèses, sans clause propre : suite du rôle fixé par l'ouvrante.
 */
function resolveInsideParens(input: SqlResolutionInput, last: SqlToken): SqlPositionResolution {
    const base = resolveOpener(input);
    const termEnd = isTermEnd(last, input.before.at(-2));

    switch (base.expectation) {
        case SqlExpectation.ColumnList:
            return last.text === "," ? base : NONE;
        case SqlExpectation.Column:
            return termEnd ? keywords([...openCaseKeywords(input.before), ...PREDICATE_KEYWORDS]) : base;
        case SqlExpectation.Value:
            return termEnd ? NONE : base;
        default:
            return NONE;
    }
}

/**
 * Ce qu'attend la dernière clause rencontrée.
 */
function resolveClause(
    input: SqlResolutionInput,
    clauseIndex: number,
    clause: SqlToken,
    last: SqlToken,
): SqlPositionResolution {
    const { before } = input;
    const termEnd = isTermEnd(last, before.at(-2));
    const openCase = openCaseKeywords(before);

    switch (clause.upper) {
        case "SELECT":
            return resolveSelectList(before, last === clause, termEnd, openCase);
        case "FROM":
        case "JOIN":
        case "INTO":
        case "TABLE":
        case "DESCRIBE":
            return resolveTableClause(input, clause, last);
        case "UPDATE":
            return resolveUpdate(input, clauseIndex, clause, last);
        case "ON":
            return resolveOn(input, clauseIndex, clause, last, termEnd);
        case "WHERE":
            return expression(termEnd, openCase, whereFollow(input.head));
        case "HAVING":
            return expression(termEnd, openCase, [...PREDICATE_KEYWORDS, "ORDER BY", "LIMIT", ...SET_OPERATORS]);
        case "BY":
            return resolveBy(wordOf(before[clauseIndex - 1]), last, termEnd, openCase);
        case "SET":
            return resolveAssignments(input, clauseIndex, last);
        case "VALUES":
            return termEnd ? keywords(["ON CONFLICT", "ON DUPLICATE KEY UPDATE", "RETURNING"]) : values();
        case "RETURNING":
            return expression(termEnd, openCase, []);
        case "USING":
            return expression(termEnd, openCase, [...JOIN_KEYWORDS, "WHERE"]);
        case "LIMIT":
            return termEnd ? keywords(["OFFSET"]) : NONE;
        case "WITH":
            return resolveWith(last, last === clause);
        case "CREATE":
            return resolveCreate(before, clauseIndex, last);
        case "BEGIN":
            return last === clause ? statementStart() : NONE;
        default:
            return NONE;
    }
}

/**
 * Clauses qui peuvent suivre une condition `WHERE`.
 */
function whereFollow(head: string | null): readonly string[] {
    if (head === "UPDATE" || head === "DELETE") {
        return [...PREDICATE_KEYWORDS, "RETURNING"];
    }

    return [...PREDICATE_KEYWORDS, "GROUP BY", "ORDER BY", "LIMIT", ...SET_OPERATORS];
}

/**
 * Liste d'un SELECT : colonnes, `*`, fonctions ; après une colonne, `AS` ou `FROM`.
 */
function resolveSelectList(
    before: readonly SqlToken[],
    isClauseLast: boolean,
    termEnd: boolean,
    openCase: readonly string[],
): SqlPositionResolution {
    const last = before.at(-1);
    const previous = before.at(-2);

    if (isClauseLast) {
        return columns(SELECT_START_KEYWORDS, true);
    }

    const lastWord = wordOf(last);
    const afterTop = last?.kind === SqlTokenKind.Number && wordOf(previous) === "TOP";

    if (lastWord === "DISTINCT" || lastWord === "ALL" || afterTop) {
        return columns(["CASE"], true);
    }

    if (termEnd) {
        const follow = last?.text === "*" ? ["FROM"] : [...openCase, "AS", "FROM"];

        return keywords(follow);
    }

    return columns(EXPRESSION_KEYWORDS, last?.text === ",");
}

/**
 * Clause qui attend une table (`FROM`, `JOIN`, `INTO`, `TABLE`, `DESCRIBE`) :
 * la table, puis son alias ou les clauses suivantes.
 */
function resolveTableClause(input: SqlResolutionInput, clause: SqlToken, last: SqlToken): SqlPositionResolution {
    const { before, head } = input;
    const word = clause.upper;

    if (last === clause) {
        if (word !== "TABLE") {
            return tables();
        }

        if (head === "CREATE") {
            return keywords(["IF NOT EXISTS"]);
        }

        return tables(head === "DROP" ? ["IF EXISTS"] : []);
    }

    if (last.text === ",") {
        return word === "FROM" ? tables() : NONE;
    }

    const isCreatedTable = word === "TABLE" && head === "CREATE";

    if (isCreatedTable || (!isIdentifier(last) && last.text !== ")")) {
        return NONE;
    }

    const previous = before.at(-2);
    const hasAlias = isIdentifier(last)
        && (isIdentifier(previous) || previous?.text === ")" || wordOf(previous) === "AS");
    const joinSnippets = word === "JOIN" || (word === "FROM" && head !== "DELETE");

    return keywords(tableFollow(word, head, hasAlias), joinSnippets);
}

/**
 * Clauses qui peuvent suivre une table.
 */
function tableFollow(clause: string, head: string | null, hasAlias: boolean): readonly string[] {
    const alias = hasAlias ? [] : ["AS"];

    switch (clause) {
        case "FROM":
            if (head === "DELETE") {
                return ["WHERE", "RETURNING", "USING"];
            }

            if (head === "SHOW" || head === "DESCRIBE") {
                return [];
            }

            return [...alias, "WHERE", ...JOIN_KEYWORDS, "GROUP BY", "ORDER BY", "LIMIT", ...SET_OPERATORS];
        case "JOIN":
            return [...alias, "ON", "USING", ...JOIN_KEYWORDS, "WHERE", "GROUP BY", "ORDER BY", "LIMIT"];
        case "INTO":
            return head === "SELECT" ? ["FROM"] : ["VALUES", "SELECT", "DEFAULT VALUES"];
        case "TABLE":
            if (head === "ALTER") {
                return ALTER_TABLE_ACTIONS;
            }

            return head === "DROP" ? ["CASCADE"] : [];
        default:
            return [];
    }
}

/**
 * `UPDATE t SET`, mais aussi `ON DUPLICATE KEY UPDATE a = …` et `DO UPDATE SET`.
 */
function resolveUpdate(
    input: SqlResolutionInput,
    clauseIndex: number,
    clause: SqlToken,
    last: SqlToken,
): SqlPositionResolution {
    const previous = wordOf(input.before[clauseIndex - 1]);

    if (previous === "KEY") {
        return resolveAssignments(input, clauseIndex, last);
    }

    if (previous === "DO") {
        return last === clause ? keywords(["SET"]) : NONE;
    }

    if (last === clause) {
        return tables();
    }

    return isIdentifier(last) ? keywords(["SET"]) : NONE;
}

/**
 * Affectations `SET a = …, b = …` : la colonne à gauche, une expression à droite.
 */
function resolveAssignments(input: SqlResolutionInput, clauseIndex: number, last: SqlToken): SqlPositionResolution {
    const { before } = input;
    let assigned = false;

    for (const token of before.slice(clauseIndex + 1)) {
        if (token.text === ",") {
            assigned = false;
        }
        else if (token.text === "=") {
            assigned = true;
        }
    }

    if (last === before[clauseIndex] || last.text === ",") {
        return columnList(modifiedTable(input.scope));
    }

    if (!assigned) {
        return NONE;
    }

    const follow = [...openCaseKeywords(before), "WHERE", "FROM", "RETURNING"];

    return isTermEnd(last, before.at(-2)) ? keywords(follow) : columns(EXPRESSION_KEYWORDS);
}

/**
 * Condition de jointure, cible d'un `CREATE INDEX … ON` ou `ON CONFLICT`.
 */
function resolveOn(
    input: SqlResolutionInput,
    clauseIndex: number,
    clause: SqlToken,
    last: SqlToken,
    termEnd: boolean,
): SqlPositionResolution {
    const { before, head } = input;
    const next = before[clauseIndex + 1];

    if (wordOf(next) === "CONFLICT") {
        return last === next || last.text === ")" ? keywords(["DO NOTHING", "DO UPDATE SET"]) : NONE;
    }

    if (head === "CREATE") {
        return last === clause ? tables() : NONE;
    }

    const follow = [...PREDICATE_KEYWORDS, ...JOIN_KEYWORDS, "WHERE", "GROUP BY", "ORDER BY", "LIMIT"];

    return expression(termEnd, openCaseKeywords(before), follow);
}

/**
 * `ORDER BY`, `GROUP BY`, `PARTITION BY`.
 */
function resolveBy(
    kind: string | null,
    last: SqlToken,
    termEnd: boolean,
    openCase: readonly string[],
): SqlPositionResolution {
    if (!termEnd) {
        return columns(["CASE"]);
    }

    switch (kind) {
        case "ORDER": {
            const hasDirection = last.upper === "ASC" || last.upper === "DESC";
            const follow = hasDirection ? ORDER_BY_FOLLOW.slice(2) : ORDER_BY_FOLLOW;

            return keywords([...openCase, ...follow]);
        }
        case "GROUP":
            return keywords([...openCase, "HAVING", "ORDER BY", "LIMIT", "WITH ROLLUP", ...SET_OPERATORS]);
        case "PARTITION":
            return keywords([...openCase, "ORDER BY"]);
        default:
            return keywords(openCase);
    }
}

/**
 * Requêtes nommées : `WITH x AS (…)` puis l'instruction principale.
 */
function resolveWith(last: SqlToken, isClauseLast: boolean): SqlPositionResolution {
    // Un `WITH` qui n'ouvre pas l'instruction est celui de `GROUP BY … WITH ROLLUP`.
    if (isClauseLast) {
        return keywords(["ROLLUP"]);
    }

    if (last.text === ")") {
        return keywords(STATEMENT_AFTER_CTE);
    }

    return isIdentifier(last) ? keywords(["AS"]) : NONE;
}

/**
 * `CREATE INDEX i` attend `ON`, `CREATE VIEW v` attend `AS`.
 */
function resolveCreate(before: readonly SqlToken[], clauseIndex: number, last: SqlToken): SqlPositionResolution {
    const targetIndex = before.findIndex((token, index) => {
        return index > clauseIndex && (token.upper === "INDEX" || token.upper === "VIEW");
    });
    const target = before[targetIndex];

    if (!target || !isIdentifier(last) || before.length - 1 <= targetIndex) {
        return NONE;
    }

    return target.upper === "INDEX" ? keywords(["ON"]) : keywords(["AS"]);
}
