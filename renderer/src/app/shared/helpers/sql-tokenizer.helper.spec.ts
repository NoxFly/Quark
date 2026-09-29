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
import { SqlTokenKind } from "src/app/core/models/sql-completion.model";
import { tokenizeSql } from "src/app/shared/helpers/sql-tokenizer.helper";

describe("tokenizeSql", () => {
    it("splits words, numbers and punctuation with their offsets", () => {
        const tokens = tokenizeSql("SELECT a, 12 FROM t;");

        expect(tokens.map(token => token.text)).toEqual(["SELECT", "a", ",", "12", "FROM", "t", ";"]);
        expect(tokens.map(token => token.kind)).toEqual([
            SqlTokenKind.Word,
            SqlTokenKind.Word,
            SqlTokenKind.Punctuation,
            SqlTokenKind.Number,
            SqlTokenKind.Word,
            SqlTokenKind.Word,
            SqlTokenKind.Punctuation,
        ]);
        expect(tokens[1]).toMatchObject({ start: 7, end: 8, upper: "A", value: "a" });
    });

    it("reads multi-character operators as a single token", () => {
        const texts = tokenizeSql("a <> b >= c || d :: e ->> f").map(token => token.text);

        expect(texts).toEqual(["a", "<>", "b", ">=", "c", "||", "d", "::", "e", "->>", "f"]);
    });

    it("reads strings with doubled quotes and flags unterminated ones", () => {
        const [closed, open] = tokenizeSql("'it''s' 'abc");

        expect(closed).toMatchObject({ kind: SqlTokenKind.String, text: "'it''s'", terminated: true });
        expect(open).toMatchObject({ kind: SqlTokenKind.String, text: "'abc", terminated: false });
    });

    it("unquotes delimited identifiers of every dialect", () => {
        const tokens = tokenizeSql("\"my \"\"table\"\" \" `order` [Order Details] \"open");

        expect(tokens.map(token => token.kind)).toEqual(Array(4).fill(SqlTokenKind.QuotedIdentifier));
        expect(tokens.map(token => token.value)).toEqual(["my \"table\" ", "order", "Order Details", "open"]);
        expect(tokens.map(token => token.terminated)).toEqual([true, true, true, false]);
    });

    it("keeps an indexed access out of the bracket identifiers", () => {
        const texts = tokenizeSql("tags[1]").map(token => token.text);

        expect(texts).toEqual(["tags", "[", "1", "]"]);
    });

    it("reads comments, a line comment never being terminated", () => {
        const [line, block, open] = tokenizeSql("-- note\n/* a */ /* b");

        expect(line).toMatchObject({ kind: SqlTokenKind.Comment, text: "-- note", terminated: false });
        expect(block).toMatchObject({ kind: SqlTokenKind.Comment, text: "/* a */", terminated: true });
        expect(open).toMatchObject({ kind: SqlTokenKind.Comment, text: "/* b", terminated: false });
    });

    it("accepts unicode letters, parameters and temporary tables in words", () => {
        const texts = tokenizeSql("données @id #tmp col$1").map(token => token.text);

        expect(texts).toEqual(["données", "@id", "#tmp", "col$1"]);
    });

    it("reads decimal, exponent and hexadecimal numbers", () => {
        const texts = tokenizeSql("1.5 2e10 0x1F").map(token => token.text);

        expect(texts).toEqual(["1.5", "2e10", "0x1F"]);
    });

    it("returns no token for blank text", () => {
        expect(tokenizeSql("  \n\t ")).toEqual([]);
    });
});
