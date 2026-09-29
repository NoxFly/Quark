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

import type { FieldDef, TableSchema } from "@shared/types";
import {
    SqlCandidateKind,
    type SqlCompletionCandidate,
    type SqlCompletionContext,
    type SqlDialect,
    SqlExpectation,
    SqlReferenceSource,
    SqlSnippetScope,
    type SqlTableIndex,
} from "src/app/core/models/sql-completion.model";
import { isReservedSqlWord } from "src/app/shared/helpers/sql-context.helper";
import { isKeywordSupported } from "src/app/shared/helpers/sql-dialect.helper";

/**
 * Longueur minimale du mot tapé avant de proposer une complétion fantôme : à
 * une lettre, presque tout est ambigu et le fantôme clignoterait à chaque frappe.
 */
export const INLINE_MIN_PREFIX = 2;

/** Identifiant qui s'écrit sans délimiteurs. */
const PLAIN_IDENTIFIER = /^[\p{L}_][\p{L}\p{N}_$]*$/u;

/**
 * @description Indexe les tables du schéma par nom, sans tenir compte de la casse.
 *
 * @param tables - Tables du schéma.
 * @returns L'index, à recalculer quand le schéma change.
 */
export function indexSqlTables(tables: readonly TableSchema[]): SqlTableIndex {
    return {
        list: tables,
        byName: new Map(tables.map(table => [table.name.toLowerCase(), table])),
    };
}

/**
 * @description Aligne la casse d'un mot-clé sur celle de la frappe : qui écrit
 * son SQL en minuscules reçoit des mots-clés en minuscules.
 *
 * @param keyword - Mot-clé en majuscules.
 * @param prefix - Mot en cours de frappe.
 * @returns Le mot-clé en minuscules si la frappe ne contient que des minuscules.
 *
 * @example
 * adaptKeywordCase("SELECT", "sel"); // "select"
 * adaptKeywordCase("SELECT", "Sel"); // "SELECT"
 */
export function adaptKeywordCase(keyword: string, prefix: string): string {
    const letters = prefix.replace(/[^\p{L}]/gu, "");
    const typedLowercase = letters !== "" && letters === letters.toLowerCase();

    return typedLowercase ? keyword.toLowerCase() : keyword;
}

/**
 * @description Délimite un identifiant s'il n'est pas valide tel quel (espace,
 * mot réservé, caractère spécial), avec les délimiteurs du dialecte.
 *
 * @param name - Nom de table ou de colonne.
 * @param dialect - Dialecte de la connexion.
 * @returns `users`, `"order"`, `` `order` `` ou `[order]`.
 */
export function quoteSqlIdentifier(name: string, dialect: SqlDialect): string {
    if (PLAIN_IDENTIFIER.test(name) && !isReservedSqlWord(name)) {
        return name;
    }

    const { open, close } = dialect.identifierQuote;
    const escaped = name.replaceAll(close, `${close}${close}`);

    return `${open}${escaped}${close}`;
}

/**
 * @description Détail d'une colonne affiché dans la liste : table, type et clés.
 *
 * @param candidate - Suggestion de colonne.
 * @returns `orders · INTEGER · PK · FK → customers`, `null` hors colonne.
 */
export function describeSqlColumn(candidate: SqlCompletionCandidate): string | null {
    const { field } = candidate;

    if (!field) {
        return null;
    }

    const parts = [candidate.owner, field.type];

    if (field.pk) {
        parts.push("PK");
    }

    if (field.fk) {
        parts.push(`FK → ${field.fk.table}`);
    }

    return parts.filter(part => part !== null && part !== "").join(" · ");
}

/**
 * @description Suggestions pour un contexte, du plus pertinent au moins
 * pertinent : l'ordre du tableau est celui de la liste à égalité de
 * correspondance avec la frappe.
 *
 * Les colonnes ne sont proposées que pour les tables de la requête du curseur ;
 * sans table (`SELECT ` sans `FROM`), ce sont les tables qui sont proposées,
 * comme qualificatifs (`table.`).
 *
 * @param context - Contexte produit par `analyzeSqlContext`.
 * @param index - Tables du schéma.
 * @param dialect - Dialecte de la connexion.
 * @returns Les suggestions, vides si rien n'est attendu.
 */
export function buildSqlCandidates(
    context: SqlCompletionContext,
    index: SqlTableIndex,
    dialect: SqlDialect,
): SqlCompletionCandidate[] {
    const { prefix } = context;

    switch (context.expectation) {
        case SqlExpectation.StatementStart:
            return [
                ...keywordCandidates(dialect.statementKeywords, prefix, dialect),
                ...snippetCandidates(dialect, SqlSnippetScope.Statement),
            ];
        case SqlExpectation.Keyword:
            return keywordExpectationCandidates(context, dialect);
        case SqlExpectation.TableName:
            return [
                ...tableCandidates(index.list, dialect, false),
                ...cteCandidates(context.cteNames, dialect, false),
                ...keywordCandidates(context.keywords, prefix, dialect),
            ];
        case SqlExpectation.QualifiedColumn:
            return qualifiedCandidates(context, index, dialect);
        case SqlExpectation.ColumnList:
            return columnListCandidates(context, index, dialect);
        case SqlExpectation.Column:
            return expressionCandidates(context, index, dialect);
        case SqlExpectation.Value:
            return [
                ...keywordCandidates(context.keywords, prefix, dialect),
                ...functionCandidates(dialect, prefix),
            ];
        default:
            return [];
    }
}

/**
 * @description Complétion fantôme : le texte à afficher en gris après le
 * curseur, quand la suite du mot tapé ne fait aucun doute — une seule
 * suggestion le prolonge.
 *
 * @param candidates - Suggestions du contexte.
 * @param prefix - Mot en cours de frappe.
 * @returns Le mot complet, frappe comprise, ou `null` s'il est ambigu, déjà
 * complet ou trop court. Un identifiant n'est complété que si la casse de la
 * frappe correspond : `ACTIV` ne devient pas `ACTIVity_logs`.
 *
 * @example
 * findInlineCompletion(candidates, "SEL"); // "SELECT"
 */
export function findInlineCompletion(candidates: readonly SqlCompletionCandidate[], prefix: string): string | null {
    if (prefix.length < INLINE_MIN_PREFIX) {
        return null;
    }

    const lowerPrefix = prefix.toLowerCase();
    let match: SqlCompletionCandidate | null = null;
    let matchLabel = "";

    // L'ambiguïté se juge sur toutes les suggestions nommées, y compris celles
    // qui ne se prêtent pas au fantôme : `ord` ne doit pas donner `orders` quand
    // la table `"order"` existe aussi.
    for (const candidate of candidates) {
        const label = candidate.label.toLowerCase();
        const isNamed = candidate.kind !== SqlCandidateKind.Snippet && candidate.kind !== SqlCandidateKind.Star;

        if (!isNamed || !label.startsWith(lowerPrefix)) {
            continue;
        }

        if (match && label !== matchLabel) {
            return null;
        }

        match ??= candidate;
        matchLabel = label;
    }

    const text = match?.inlineText;

    if (!match || !text || text.length === prefix.length) {
        return null;
    }

    if (text.startsWith(prefix)) {
        return text;
    }

    const caseInsensitive = match.kind === SqlCandidateKind.Keyword || match.kind === SqlCandidateKind.Function;
    const remainder = text.slice(prefix.length);

    return caseInsensitive ? `${prefix}${remainder}` : null;
}

/**
 * Suggestion avec ses valeurs par défaut.
 */
function createCandidate(
    kind: SqlCandidateKind,
    label: string,
    insertText: string,
    overrides: Partial<SqlCompletionCandidate> = {},
): SqlCompletionCandidate {
    return {
        kind,
        label,
        insertText,
        isSnippet: false,
        inlineText: null,
        retrigger: false,
        table: null,
        owner: null,
        field: null,
        description: null,
        ...overrides,
    };
}

/**
 * Mots-clés reconnus par le dialecte, sans doublon, dans la casse de la frappe.
 */
function keywordCandidates(list: readonly string[], prefix: string, dialect: SqlDialect): SqlCompletionCandidate[] {
    const seen = new Set<string>();
    const candidates: SqlCompletionCandidate[] = [];

    for (const keyword of list) {
        if (seen.has(keyword) || !isKeywordSupported(dialect, keyword)) {
            continue;
        }

        const label = adaptKeywordCase(keyword, prefix);

        seen.add(keyword);
        candidates.push(createCandidate(SqlCandidateKind.Keyword, label, label, { inlineText: label }));
    }

    return candidates;
}

/**
 * Mots-clés attendus ; en T-SQL, qui enchaîne ses instructions sans `;`, aussi
 * les débuts d'instruction.
 */
function keywordExpectationCandidates(context: SqlCompletionContext, dialect: SqlDialect): SqlCompletionCandidate[] {
    const list = dialect.implicitStatementSeparator
        ? [...context.keywords, ...dialect.statementKeywords]
        : context.keywords;
    const candidates = keywordCandidates(list, context.prefix, dialect);

    if (context.joinSnippets) {
        candidates.push(...snippetCandidates(dialect, SqlSnippetScope.Join));
    }

    return candidates;
}

/**
 * Fonctions du dialecte : l'insertion place le curseur entre les parenthèses.
 */
function functionCandidates(dialect: SqlDialect, prefix: string): SqlCompletionCandidate[] {
    return dialect.functions.map(name => {
        const label = adaptKeywordCase(name, prefix);

        return createCandidate(SqlCandidateKind.Function, label, `${label}($0)`, { isSnippet: true, inlineText: label });
    });
}

/**
 * Extraits du dialecte pour une portée.
 */
function snippetCandidates(dialect: SqlDialect, scope: SqlSnippetScope): SqlCompletionCandidate[] {
    return dialect.snippets
        .filter(snippet => snippet.scope === scope)
        .map(snippet => createCandidate(SqlCandidateKind.Snippet, snippet.prefix, snippet.body, {
            isSnippet: true,
            description: snippet.description,
        }));
}

/**
 * Tables du schéma. En qualificatif, l'insertion ajoute le point et rouvre la
 * liste sur les colonnes de la table.
 */
function tableCandidates(
    tables: readonly TableSchema[],
    dialect: SqlDialect,
    asQualifier: boolean,
): SqlCompletionCandidate[] {
    return tables.map(table => {
        const name = quoteSqlIdentifier(table.name, dialect);

        return createCandidate(SqlCandidateKind.Table, table.name, asQualifier ? `${name}.` : name, {
            inlineText: name === table.name ? name : null,
            retrigger: asQualifier,
            table,
            owner: table.name,
        });
    });
}

/**
 * Requêtes nommées (`WITH`), dont les colonnes ne sont pas connues.
 */
function cteCandidates(names: readonly string[], dialect: SqlDialect, asQualifier: boolean): SqlCompletionCandidate[] {
    return names.map(cte => {
        const name = quoteSqlIdentifier(cte, dialect);

        return createCandidate(SqlCandidateKind.Cte, cte, asQualifier ? `${name}.` : name, {
            inlineText: name === cte ? name : null,
            retrigger: asQualifier,
            owner: cte,
        });
    });
}

/**
 * Colonne d'une table, qualifiée par `qualifier` quand son nom seul serait
 * ambigu dans la requête.
 */
function columnCandidate(
    table: TableSchema,
    field: FieldDef,
    qualifier: string | null,
    dialect: SqlDialect,
): SqlCompletionCandidate {
    const name = quoteSqlIdentifier(field.name, dialect);
    const qualified = qualifier === null ? name : `${quoteSqlIdentifier(qualifier, dialect)}.${name}`;
    const isPlain = qualifier === null && name === field.name;

    return createCandidate(SqlCandidateKind.Column, field.name, qualified, {
        inlineText: isPlain ? name : null,
        table,
        owner: table.name,
        field,
    });
}

/**
 * Colonnes d'une table, sans qualificatif.
 */
function columnCandidates(table: TableSchema, dialect: SqlDialect): SqlCompletionCandidate[] {
    return table.fields.map(field => columnCandidate(table, field, null, dialect));
}

function starCandidate(): SqlCompletionCandidate {
    return createCandidate(SqlCandidateKind.Star, "*", "*");
}

/**
 * Table d'un nom, sans tenir compte de la casse.
 */
function findTable(index: SqlTableIndex, name: string | null): TableSchema | null {
    return name === null ? null : index.byName.get(name.toLowerCase()) ?? null;
}

/**
 * Colonnes de la table désignée par le qualificatif : un alias de la requête,
 * sinon un nom de table.
 */
function qualifiedCandidates(
    context: SqlCompletionContext,
    index: SqlTableIndex,
    dialect: SqlDialect,
): SqlCompletionCandidate[] {
    const qualifier = context.qualifier?.toLowerCase();
    const aliased = context.scope.find(reference => reference.alias?.toLowerCase() === qualifier);
    const tableName = aliased ? aliased.table : context.qualifier;
    const table = findTable(index, tableName);
    const candidates = table ? columnCandidates(table, dialect) : [];

    if (context.allowStar) {
        candidates.push(starCandidate());
    }

    return candidates;
}

/**
 * Colonnes d'une table cible (`INSERT INTO t (`, `SET`).
 */
function columnListCandidates(
    context: SqlCompletionContext,
    index: SqlTableIndex,
    dialect: SqlDialect,
): SqlCompletionCandidate[] {
    const table = findTable(index, context.target);

    return table ? columnCandidates(table, dialect) : [];
}

/**
 * Expression : `*`, colonnes des tables de la requête, qualificatifs,
 * fonctions, mots-clés et extraits d'expression.
 */
function expressionCandidates(
    context: SqlCompletionContext,
    index: SqlTableIndex,
    dialect: SqlDialect,
): SqlCompletionCandidate[] {
    const candidates: SqlCompletionCandidate[] = [];

    if (context.allowStar) {
        candidates.push(starCandidate());
    }

    // Les colonnes de l'INSERT ne sont pas des opérandes du SELECT qui l'alimente.
    const local = context.scope.filter(reference => !reference.outer && reference.source !== SqlReferenceSource.Into);
    const resolved = local.map(reference => ({ reference, table: findTable(index, reference.table) }));
    const occurrences = countColumnNames(resolved.map(entry => entry.table));

    for (const { reference, table } of resolved) {
        if (!table) {
            continue;
        }

        const qualifier = reference.alias ?? table.name;

        for (const field of table.fields) {
            const isAmbiguous = (occurrences.get(field.name.toLowerCase()) ?? 0) > 1;

            candidates.push(columnCandidate(table, field, isAmbiguous ? qualifier : null, dialect));
        }
    }

    candidates.push(...qualifierCandidates(context, index, dialect, local.length === 0));
    candidates.push(...functionCandidates(dialect, context.prefix));
    candidates.push(...keywordCandidates(context.keywords, context.prefix, dialect));
    candidates.push(...snippetCandidates(dialect, SqlSnippetScope.Expression));

    return candidates;
}

/**
 * Nombre de références de la requête qui ont chaque nom de colonne. Une table
 * jointe à elle-même compte deux fois : ses colonnes doivent être qualifiées.
 */
function countColumnNames(tables: readonly (TableSchema | null)[]): Map<string, number> {
    const occurrences = new Map<string, number>();

    for (const table of tables) {
        for (const field of table?.fields ?? []) {
            const name = field.name.toLowerCase();

            occurrences.set(name, (occurrences.get(name) ?? 0) + 1);
        }
    }

    return occurrences;
}

/**
 * Qualificatifs : alias et tables de la requête, ou toutes les tables quand
 * la requête n'en cite encore aucune.
 */
function qualifierCandidates(
    context: SqlCompletionContext,
    index: SqlTableIndex,
    dialect: SqlDialect,
    noLocalTable: boolean,
): SqlCompletionCandidate[] {
    if (noLocalTable) {
        return [...tableCandidates(index.list, dialect, true), ...cteCandidates(context.cteNames, dialect, true)];
    }

    const seen = new Set<string>();
    const candidates: SqlCompletionCandidate[] = [];

    for (const reference of context.scope) {
        const label = reference.alias ?? reference.table;

        if (label === null || seen.has(label.toLowerCase())) {
            continue;
        }

        seen.add(label.toLowerCase());

        const name = quoteSqlIdentifier(label, dialect);
        const table = findTable(index, reference.table);

        candidates.push(createCandidate(qualifierKind(reference.alias, table), label, `${name}.`, {
            inlineText: name === label ? name : null,
            retrigger: true,
            table,
            owner: reference.table,
        }));
    }

    return candidates;
}

/**
 * Nature d'un qualificatif de la requête : alias, table du schéma ou requête nommée.
 */
function qualifierKind(alias: string | null, table: TableSchema | null): SqlCandidateKind {
    if (alias !== null) {
        return SqlCandidateKind.Alias;
    }

    return table ? SqlCandidateKind.Table : SqlCandidateKind.Cte;
}
