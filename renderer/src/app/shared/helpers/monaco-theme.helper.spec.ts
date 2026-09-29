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
    buildMonacoTheme,
    cssColorToHex,
    isDarkColor,
    MONACO_PALETTE_TOKENS,
    readMonacoPalette,
} from "src/app/shared/helpers/monaco-theme.helper";

describe("cssColorToHex", () => {
    it("normalises hexadecimal colors", () => {
        expect(cssColorToHex("#ABC")).toBe("#aabbcc");
        expect(cssColorToHex("  #5B5AA8 ")).toBe("#5b5aa8");
    });

    it("converts rgb() and rgba() colors", () => {
        expect(cssColorToHex("rgb(91, 90, 168)")).toBe("#5b5aa8");
        expect(cssColorToHex("rgba(0, 0, 0, 0.5)")).toBe("#000000");
        expect(cssColorToHex("rgb(255 255 255 / 50%)")).toBe("#ffffff");
    });

    it("rejects unsupported or invalid values", () => {
        expect(cssColorToHex("")).toBeNull();
        expect(cssColorToHex("#abcd")).toBeNull();
        expect(cssColorToHex("#ggg")).toBeNull();
        expect(cssColorToHex("rgb(256, 0, 0)")).toBeNull();
        expect(cssColorToHex("var(--accent)")).toBeNull();
        expect(cssColorToHex("red")).toBeNull();
    });
});

describe("isDarkColor", () => {
    it("tells dark backgrounds from light ones", () => {
        expect(isDarkColor("#222228")).toBe(true);
        expect(isDarkColor("#101014")).toBe(true);
        expect(isDarkColor("#fafafb")).toBe(false);
        expect(isDarkColor("#808080")).toBe(false);
        expect(isDarkColor("#7f7f7f")).toBe(true);
    });
});

describe("readMonacoPalette", () => {
    it("reads every token and falls back on unreadable ones", () => {
        const values: Record<string, string> = {
            "--text": "#e6e6ea",
            "--bg-subtle": "rgb(34, 34, 40)",
            "--syntax-keyword": "not-a-color",
        };
        const requested: string[] = [];

        const palette = readMonacoPalette(property => {
            requested.push(property);
            return values[property] ?? "";
        });

        expect(requested.sort()).toEqual(Object.values(MONACO_PALETTE_TOKENS).sort());
        expect(palette.text).toBe("#e6e6ea");
        expect(palette.background).toBe("#222228");
        expect(palette.keyword).toBe("#5b5aa8");
        expect(palette.gutter).toBe("#a8a8b3");
    });
});

describe("buildMonacoTheme", () => {
    const light = readMonacoPalette(() => "");

    it("maps the syntax tokens to Monaco rules without the leading hash", () => {
        const theme = buildMonacoTheme({ ...light, keyword: "#112233", string: "#445566" });

        expect(theme.inherit).toBe(true);
        expect(theme.rules).toContainEqual({ token: "keyword", foreground: "112233", fontStyle: "bold" });
        expect(theme.rules).toContainEqual({ token: "string", foreground: "445566" });
        expect(theme.rules.every(rule => !rule.foreground?.startsWith("#"))).toBe(true);
    });

    it("uses the app surfaces for the editor and its gutter", () => {
        const theme = buildMonacoTheme(light);

        expect(theme.colors["editor.background"]).toBe(light.background);
        expect(theme.colors["editorGutter.background"]).toBe(light.gutterBackground);
        expect(theme.colors["editorLineNumber.foreground"]).toBe(light.gutter);
    });

    it("picks the base theme from the background luminosity", () => {
        expect(buildMonacoTheme(light).base).toBe("vs");
        expect(buildMonacoTheme({ ...light, background: "#222228" }).base).toBe("vs-dark");
    });
});
