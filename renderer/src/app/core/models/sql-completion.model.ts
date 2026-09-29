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

/** Nature d'un jeton SQL. */
export enum SqlTokenKind {
    /** Identifiant ou mot-clé non délimité (`SELECT`, `users`, `@param`). */
    Word,
    /** Identifiant délimité : `"x"`, `` `x` `` ou `[x]`. */
    QuotedIdentifier,
    /** Chaîne littérale `'x'`. */
    String,
    Number,
    /** Commentaire `-- …` ou `/* … *\/`. */
    Comment,
    /** Ponctuation et opérateurs : `(`, `,`, `.`, `;`, `=`, `<>`… */
    Punctuation,
}

/** Jeton produit par `tokenizeSql`. */
export interface SqlToken {
    kind: SqlTokenKind;
    /** Texte brut, délimiteurs compris. */
    text: string;
    /** Texte en majuscules, pour comparer aux mots-clés. */
    upper: string;
    /** Valeur utile : l'identifiant sans ses délimiteurs, sinon le texte brut. */
    value: string;
    /** Décalage du premier caractère dans le texte analysé. */
    start: number;
    /** Décalage qui suit le dernier caractère. */
    end: number;
    /**
     * Le délimiteur fermant est présent. Toujours faux pour un commentaire de
     * ligne, qui se poursuit tant que la ligne n'est pas terminée.
     */
    terminated: boolean;
}

/** Jeton qui peut désigner une table, une colonne ou un alias. */
export interface SqlIdentifierToken extends SqlToken {
    kind: SqlTokenKind.Word | SqlTokenKind.QuotedIdentifier;
}

/** Ce que la grammaire attend à la position du curseur. */
export enum SqlExpectation {
    /** Rien d'utile à proposer : nom à inventer, nombre, chaîne… */
    None,
    /** Début d'instruction : `SELECT`, `INSERT INTO`… et extraits de requête. */
    StatementStart,
    /** Uniquement les mots-clés de `SqlCompletionContext.keywords`. */
    Keyword,
    /** Un nom de table. */
    TableName,
    /** Une expression : colonnes des tables de la requête, fonctions. */
    Column,
    /** Une colonne de la table désignée par `SqlCompletionContext.qualifier`. */
    QualifiedColumn,
    /** Une colonne de `SqlCompletionContext.target`, sans expression (`INSERT INTO t (…)`, `SET …`). */
    ColumnList,
    /** Une valeur littérale (`VALUES (…)`) : fonctions et mots-clés de valeur. */
    Value,
}

/** Clause qui a introduit une table dans la requête. */
export enum SqlReferenceSource {
    From,
    Join,
    Update,
    Into,
    /** `ALTER TABLE t`, `DROP TABLE t`, `CREATE INDEX … ON t`, `DESCRIBE t`. */
    Table,
}

/** Table (ou sous-requête nommée) référencée par une requête. */
export interface SqlTableReference {
    /** Nom de la table, `null` pour une sous-requête du FROM. */
    table: string | null;
    alias: string | null;
    source: SqlReferenceSource;
    /**
     * La référence appartient à une requête englobante : elle sert à résoudre
     * un qualificatif (sous-requête corrélée) mais ses colonnes ne sont pas
     * proposées sans qualificatif.
     */
    outer: boolean;
}

/** Ce que l'analyseur a déduit de la position du curseur. */
export interface SqlPositionResolution {
    expectation: SqlExpectation;
    /** Mots-clés valides à cette position, avant filtrage par dialecte. */
    keywords: readonly string[];
    /** Qualificatif saisi avant le point (`alias.`), pour `QualifiedColumn`. */
    qualifier: string | null;
    /** Table dont on attend les colonnes, pour `ColumnList`. */
    target: string | null;
    /** `*` (ou `t.*`) est permis à cette position. */
    allowStar: boolean;
    /** Des extraits de jointure sont pertinents (après une table du FROM). */
    joinSnippets: boolean;
}

/** Contexte complet de la position du curseur, indépendant de Monaco. */
export interface SqlCompletionContext extends SqlPositionResolution {
    /** Mot en cours de frappe, éventuellement vide. */
    prefix: string;
    /** Décalage du début du mot en cours de frappe. */
    prefixStart: number;
    /** Tables référencées par la requête du curseur, puis par les requêtes englobantes. */
    scope: readonly SqlTableReference[];
    /** Noms des requêtes nommées (`WITH x AS (…)`) de l'instruction. */
    cteNames: readonly string[];
}

/** Données transmises aux règles de résolution de l'analyseur. */
export interface SqlResolutionInput {
    /** Jetons de la requête du curseur, à son niveau de parenthèses, avant le mot en cours. */
    before: readonly SqlToken[];
    /** Le curseur est entre parenthèses. */
    insideParens: boolean;
    /** Jeton qui précède la parenthèse ouvrante englobant le curseur. */
    opener: SqlToken | undefined;
    /** Jeton qui précède `opener`. */
    openerPrevious: SqlToken | undefined;
    /** Clause du niveau qui contient la parenthèse ouvrante (`VALUES (…), (`). */
    enclosingClause: string | null;
    /** Verbe de l'instruction (`SELECT`, `DELETE`, `CREATE`…). */
    head: string | null;
    scope: readonly SqlTableReference[];
}

/** Portée d'un extrait de code. */
export enum SqlSnippetScope {
    /** Instruction complète, proposée en début d'instruction. */
    Statement,
    /** Jointure, proposée après une table du FROM. */
    Join,
    /** Expression, proposée là où une colonne est attendue. */
    Expression,
}

/** Extrait de code au format des snippets Monaco (`${1:table}`). */
export interface SqlSnippet {
    /** Mot à taper pour le proposer (`sel`, `ij`…). */
    prefix: string;
    body: string;
    /** Aperçu affiché dans la liste (`SELECT … FROM …`). */
    description: string;
    scope: SqlSnippetScope;
}

/** Délimiteurs d'un identifiant qui doit être échappé. */
export interface SqlIdentifierQuote {
    open: string;
    close: string;
}

/** Vocabulaire d'un dialecte SQL. */
export interface SqlDialect {
    /**
     * Mots-clés propres au dialecte parmi ceux que tous les dialectes ne
     * connaissent pas (`LIMIT`, `TOP`, `ILIKE`…). Un mot-clé qui n'apparaît
     * dans aucun dialecte est commun à tous.
     */
    specificKeywords: ReadonlySet<string>;
    /** Mots-clés proposés en début d'instruction. */
    statementKeywords: readonly string[];
    /** Fonctions, en majuscules. */
    functions: readonly string[];
    snippets: readonly SqlSnippet[];
    identifierQuote: SqlIdentifierQuote;
    /** Les instructions peuvent s'enchaîner sans `;` (T-SQL). */
    implicitStatementSeparator: boolean;
}

/** Tables du schéma, indexées pour les recherches par nom. */
export interface SqlTableIndex {
    list: readonly TableSchema[];
    /** Tables par nom en minuscules. */
    byName: ReadonlyMap<string, TableSchema>;
}

/** Nature d'une suggestion, convertie en icône par le service Monaco. */
export enum SqlCandidateKind {
    Keyword,
    Function,
    Table,
    /** Requête nommée (`WITH`). */
    Cte,
    Alias,
    Column,
    /** `*`. */
    Star,
    Snippet,
}

/** Suggestion d'autocomplétion, indépendante de Monaco. */
export interface SqlCompletionCandidate {
    kind: SqlCandidateKind;
    label: string;
    insertText: string;
    /** `insertText` est un snippet (tabulations `${1:…}`). */
    isSnippet: boolean;
    /**
     * Texte proposé en complétion fantôme, `null` si la suggestion ne s'y prête
     * pas (extrait, `*`, identifiant échappé).
     */
    inlineText: string | null;
    /** Rouvrir la liste après insertion : `table.` appelle ses colonnes. */
    retrigger: boolean;
    /** Table de la colonne ou de l'alias, ou table proposée. */
    table: TableSchema | null;
    /** Nom de la table visée par un alias, même hors du schéma (requête nommée). */
    owner: string | null;
    field: FieldDef | null;
    /** Aperçu d'un extrait. */
    description: string | null;
}

/**
 * Analyse d'une position de l'éditeur. Le menu et la complétion fantôme la
 * demandent tour à tour pour la même frappe : elle n'est calculée qu'une fois.
 */
export interface SqlCompletionAnalysis {
    model: import("monaco-editor").editor.ITextModel;
    /** Version du modèle analysée : toute frappe l'incrémente. */
    version: number;
    offset: number;
    tables: SqlTableIndex;
    dialect: SqlDialect;
    context: SqlCompletionContext;
    candidates: readonly SqlCompletionCandidate[];
}
