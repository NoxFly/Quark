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

import { type SqlToken, SqlTokenKind } from "src/app/core/models/sql-completion.model";

const WHITESPACE = /\s+/y;
const LINE_COMMENT = /--[^\n]*/y;
const BLOCK_COMMENT = /\/\*[\s\S]*?(?<close>\*\/|$)/y;
const STRING = /'(?:[^']|'')*(?<close>')?/y;
const DOUBLE_QUOTED = /"(?:[^"]|"")*(?<close>")?/y;
const BACKTICK_QUOTED = /`(?:[^`]|``)*(?<close>`)?/y;

/**
 * `[x]` n'est un identifiant T-SQL que s'il ne commence pas par un chiffre :
 * `tableau[1]` (PostgreSQL) reste un accès indicé.
 */
const BRACKET_QUOTED = /\[(?=[^\d\]\s])[^\]]*(?<close>\])?/y;

const WORD = /[\p{L}_@#][\p{L}\p{N}_$@#]*/uy;
const NUMBER = /0x[\da-f]+|\d+(?:\.\d*)?(?:e[+-]?\d+)?/iy;
const OPERATOR = /<>|!=|<=|>=|\|\||::|->>|->|:=|\S/y;

/** Lecteurs essayés dans l'ordre à chaque position, avant la ponctuation. */
const READERS: readonly (readonly [RegExp, SqlTokenKind])[] = [
    [LINE_COMMENT, SqlTokenKind.Comment],
    [BLOCK_COMMENT, SqlTokenKind.Comment],
    [STRING, SqlTokenKind.String],
    [DOUBLE_QUOTED, SqlTokenKind.QuotedIdentifier],
    [BACKTICK_QUOTED, SqlTokenKind.QuotedIdentifier],
    [BRACKET_QUOTED, SqlTokenKind.QuotedIdentifier],
    [WORD, SqlTokenKind.Word],
    [NUMBER, SqlTokenKind.Number],
];

/**
 * @description Découpe un texte SQL en jetons, commentaires compris. Le
 * découpage est tolérant : une chaîne, un identifiant délimité ou un
 * commentaire non fermé s'étend jusqu'à la fin du texte (`terminated: false`),
 * ce qui est l'état normal d'une requête en cours de frappe.
 *
 * Le découpage ne dépend d'aucun dialecte : `"x"` est toujours un identifiant,
 * `[x]` aussi quand il ne commence pas par un chiffre.
 *
 * @param text - Texte à découper.
 * @returns Les jetons, dans l'ordre du texte, sans les espaces.
 *
 * @example
 * tokenizeSql("SELECT a FROM t").map(t => t.text); // ["SELECT", "a", "FROM", "t"]
 */
export function tokenizeSql(text: string): SqlToken[] {
    const tokens: SqlToken[] = [];
    let index = 0;

    while (index < text.length) {
        WHITESPACE.lastIndex = index;

        if (WHITESPACE.test(text)) {
            index = WHITESPACE.lastIndex;
            continue;
        }

        const token = readToken(text, index);

        tokens.push(token);
        index = token.end;
    }

    return tokens;
}

/**
 * Lit le jeton qui commence à `index`, qui n'est pas un espace.
 */
function readToken(text: string, index: number): SqlToken {
    for (const [reader, kind] of READERS) {
        reader.lastIndex = index;
        const match = reader.exec(text);

        if (match) {
            return createToken(kind, match[0], match.groups?.["close"], index);
        }
    }

    OPERATOR.lastIndex = index;
    const operator = OPERATOR.exec(text)?.[0] ?? text.charAt(index);

    return createToken(SqlTokenKind.Punctuation, operator, undefined, index);
}

/**
 * Construit un jeton.
 *
 * @param close - Délimiteur fermant capturé, vide ou absent s'il manque.
 */
function createToken(kind: SqlTokenKind, text: string, close: string | undefined, start: number): SqlToken {
    const isComment = kind === SqlTokenKind.Comment;
    const isLineComment = isComment && text.startsWith("--");
    const hasCloser = close !== undefined && close !== "";
    let terminated = true;

    if (isLineComment) {
        terminated = false;
    }
    else if (kind === SqlTokenKind.String || kind === SqlTokenKind.QuotedIdentifier || isComment) {
        terminated = hasCloser;
    }

    return {
        kind,
        text,
        upper: text.toUpperCase(),
        value: kind === SqlTokenKind.QuotedIdentifier ? unquote(text, terminated) : text,
        start,
        end: start + text.length,
        terminated,
    };
}

/**
 * Retire les délimiteurs d'un identifiant et ramène leurs doublons à un seul.
 */
function unquote(text: string, terminated: boolean): string {
    const open = text.charAt(0);
    const inner = text.slice(1, terminated ? -1 : undefined);

    if (open === "[") {
        return inner;
    }

    return inner.replaceAll(`${open}${open}`, open);
}
