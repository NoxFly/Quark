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

import type { FieldDef, MutationRecord } from "@shared/types";
import { describe, expect, it } from "vitest";
import {
    columnMinWidth,
    columnTrack,
    epochUnit,
    formatEpoch,
    gridMinWidth,
    gridTemplateColumns,
    hasTimestampName,
    isIntegerType,
    isLongTextType,
    isTextType,
    isTimestampCandidate,
    rowMarksFromHistory,
} from "src/app/shared/helpers/data-grid.helper";

function field(name: string, type: string, extra: Partial<FieldDef> = {}): FieldDef {
    return { name, type, notnull: false, dflt_value: null, pk: false, fk: null, ...extra };
}

describe("types de colonnes", () => {
    it("reconnaît les types entiers", () => {
        expect(isIntegerType("INTEGER")).toBe(true);
        expect(isIntegerType("bigint")).toBe(true);
        expect(isIntegerType("NUMBER")).toBe(true);
        expect(isIntegerType("TEXT")).toBe(false);
        expect(isIntegerType("REAL")).toBe(false);
    });

    it("reconnaît les types textuels, colonne sans type comprise", () => {
        expect(isTextType("TEXT")).toBe(true);
        expect(isTextType("VARCHAR(50)")).toBe(true);
        expect(isTextType("string")).toBe(true);
        expect(isTextType("")).toBe(true);
        expect(isTextType("INTEGER")).toBe(false);
    });

    it("distingue les textes longs", () => {
        expect(isLongTextType("TEXT")).toBe(true);
        expect(isLongTextType("LONGTEXT")).toBe(true);
        expect(isLongTextType("VARCHAR(1000)")).toBe(true);
        expect(isLongTextType("VARCHAR(80)")).toBe(false);
        expect(isLongTextType("CHAR(2)")).toBe(false);
    });
});

describe("epochUnit", () => {
    it("détecte les secondes et les millisecondes", () => {
        expect(epochUnit(1_700_000_000)).toBe("s");
        expect(epochUnit(1_700_000_000_000)).toBe("ms");
        expect(epochUnit("1700000000")).toBe("s");
    });

    it("écarte les valeurs hors plage ou non entières", () => {
        expect(epochUnit(42)).toBeNull();
        expect(epochUnit(20_240_101)).toBeNull();
        expect(epochUnit(1_700_000_000.5)).toBeNull();
        expect(epochUnit("abc")).toBeNull();
        expect(epochUnit("")).toBeNull();
        expect(epochUnit(null)).toBeNull();
        expect(epochUnit(9_999_999_999_999)).toBeNull();
    });
});

describe("hasTimestampName", () => {
    it("reconnaît les noms usuels", () => {
        for (const name of ["cree_le", "created_at", "date_commande", "updated", "timestamp", "last_login", "modif_ts"]) {
            expect(hasTimestampName(name), name).toBe(true);
        }
    });

    it("ignore les autres noms", () => {
        for (const name of ["id", "status", "total", "nom", "quantite"]) {
            expect(hasTimestampName(name), name).toBe(false);
        }
    });
});

describe("isTimestampCandidate", () => {
    it("retient une colonne au nom évocateur sans valeur chargée", () => {
        expect(isTimestampCandidate(field("created_at", "INTEGER"), [])).toBe(true);
    });

    it("retient une colonne au nom évocateur dont les valeurs sont plausibles", () => {
        expect(isTimestampCandidate(field("cree_le", "INTEGER"), [1_700_000_000, null, 1_710_000_000])).toBe(true);
    });

    it("écarte un nom évocateur contredit par les valeurs", () => {
        expect(isTimestampCandidate(field("date", "INTEGER"), [20_240_101])).toBe(false);
    });

    it("retient sans nom évocateur des valeurs en millisecondes seulement", () => {
        expect(isTimestampCandidate(field("x", "BIGINT"), [1_700_000_000_000])).toBe(true);
        expect(isTimestampCandidate(field("telephone", "INTEGER"), [612_345_678])).toBe(false);
        expect(isTimestampCandidate(field("x", "BIGINT"), [])).toBe(false);
    });

    it("écarte les types non entiers et les clés", () => {
        expect(isTimestampCandidate(field("created_at", "TEXT"), [])).toBe(false);
        expect(isTimestampCandidate(field("created_at", "INTEGER", { pk: true }), [])).toBe(false);
        expect(isTimestampCandidate(field("created_at", "INTEGER", { fk: { table: "t", column: "c" } }), [])).toBe(false);
    });
});

describe("formatEpoch", () => {
    it("formate en jj/mm/aaaa hh:mm en français", () => {
        const date = new Date(2024, 2, 15, 14, 30, 45);
        expect(formatEpoch(Math.floor(date.getTime() / 1000), "fr-FR")).toBe("15/03/2024 14:30");
        expect(formatEpoch(date.getTime(), "fr-FR")).toBe("15/03/2024 14:30");
    });

    it("retourne null pour une valeur non plausible", () => {
        expect(formatEpoch(12, "fr-FR")).toBeNull();
        expect(formatEpoch("texte", "fr-FR")).toBeNull();
    });
});

describe("largeurs de colonnes", () => {
    const fields = [field("id", "INTEGER"), field("nom", "VARCHAR(80)"), field("commentaire", "TEXT")];

    it("choisit la piste selon le type", () => {
        expect(columnTrack(fields[0] as FieldDef)).toBe("minmax(130px, 0.7fr)");
        expect(columnTrack(fields[1] as FieldDef)).toBe("minmax(160px, 1fr)");
        expect(columnTrack(fields[2] as FieldDef)).toBe("minmax(280px, 2fr)");
        expect(columnTrack(fields[1] as FieldDef, 90)).toBe("90px");
    });

    it("construit le gabarit complet, colonne # comprise", () => {
        const widths = new Map([["nom", 200]]);
        expect(gridTemplateColumns(fields, widths)).toBe("44px minmax(130px, 0.7fr) 200px minmax(280px, 2fr)");
        expect(gridMinWidth(fields, widths)).toBe(44 + 130 + 200 + 280);
        expect(columnMinWidth(fields[1] as FieldDef)).toBe(160);
    });
});

describe("rowMarksFromHistory", () => {
    const base = { id: 0 };

    it("marque les lignes insérées et modifiées de la table seulement", () => {
        const history: MutationRecord[] = [
            { ...base, type: "update", table: "clients", rowid: 1, column: "nom" },
            { ...base, type: "insert", table: "clients", rowid: 2 },
            { ...base, type: "update", table: "clients", rowid: 2, column: "nom" },
            { ...base, type: "update", table: "commandes", rowid: 3, column: "total" },
            { ...base, type: "update", table: "clients", rowid: 4, column: "nom" },
            { ...base, type: "delete", table: "clients", rowid: 4 },
        ];

        const marks = rowMarksFromHistory(history, "clients");

        expect(marks.get(1)).toBe("modified");
        expect(marks.get(2)).toBe("inserted");
        expect(marks.has(3)).toBe(false);
        expect(marks.has(4)).toBe(false);
    });
});
