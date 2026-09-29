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

import type { MonacoPalette, MonacoThemeDefinition } from "src/app/core/models/monaco-theme.model";

/** Correspondance entre les champs de la palette et les design tokens CSS. */
export const MONACO_PALETTE_TOKENS: Readonly<Record<keyof MonacoPalette, string>> = {
    text: "--text",
    textMuted: "--text-muted",
    background: "--bg-subtle",
    gutterBackground: "--bg-panel",
    gutter: "--syntax-gutter",
    selection: "--bg-selected",
    lineHighlight: "--bg-row-hover",
    border: "--border-muted",
    accent: "--accent",
    keyword: "--syntax-keyword",
    string: "--syntax-string",
    number: "--syntax-number",
    comment: "--syntax-comment",
    function: "--syntax-function",
};

/** Couleurs de repli, utilisées si un token est absent ou illisible. */
const FALLBACK_PALETTE: MonacoPalette = {
    text: "#1f1f24",
    textMuted: "#6b6b76",
    background: "#fafafb",
    gutterBackground: "#f3f3f5",
    gutter: "#a8a8b3",
    selection: "#e8e8f6",
    lineHighlight: "#f3f3f8",
    border: "#e6e6eb",
    accent: "#5b5aa8",
    keyword: "#5b5aa8",
    string: "#9a6700",
    number: "#0b7285",
    comment: "#8a8a95",
    function: "#7a3e9d",
};

const HEX_PATTERN = /^#(?<hex>[0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB_PATTERN = /^rgba?\(\s*(?<r>\d{1,3})[\s,]+(?<g>\d{1,3})[\s,]+(?<b>\d{1,3})(?:[\s,/]+[\d.]+%?)?\s*\)$/i;

/**
 * Convertit une couleur CSS calculée en `#rrggbb`, seul format accepté par Monaco.
 *
 * @param value - Valeur d'une propriété personnalisée (`#abc`, `#aabbcc`, `rgb(…)`).
 * @returns La couleur en minuscules, ou `null` si le format n'est pas reconnu.
 * @example
 * cssColorToHex("#ABC");            // "#aabbcc"
 * cssColorToHex("rgb(91, 90, 168)"); // "#5b5aa8"
 */
export function cssColorToHex(value: string): string | null {
    const trimmed = value.trim();
    const hexMatch = HEX_PATTERN.exec(trimmed);
    const hex = hexMatch?.groups?.["hex"];

    if (hex) {
        const full = hex.length === 3
            ? hex.split("").map(char => char + char).join("")
            : hex;

        return `#${full.toLowerCase()}`;
    }

    const rgb = RGB_PATTERN.exec(trimmed)?.groups;

    if (!rgb) {
        return null;
    }

    const channels = [rgb["r"], rgb["g"], rgb["b"]].map(channel => Number(channel));

    if (channels.some(channel => Number.isNaN(channel) || channel > 255)) {
        return null;
    }

    const encoded = channels.map(channel => channel.toString(16).padStart(2, "0")).join("");

    return `#${encoded}`;
}

/**
 * Indique si une couleur est sombre (luminance relative inférieure à 0,5).
 *
 * @param hex - Couleur `#rrggbb`.
 */
export function isDarkColor(hex: string): boolean {
    const red = Number.parseInt(hex.slice(1, 3), 16);
    const green = Number.parseInt(hex.slice(3, 5), 16);
    const blue = Number.parseInt(hex.slice(5, 7), 16);
    const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;

    return luminance < 0.5;
}

/**
 * Construit la palette à partir d'un lecteur de propriétés CSS.
 *
 * @param read - Retourne la valeur calculée d'une propriété personnalisée.
 * @returns La palette, chaque token illisible étant remplacé par sa couleur de repli.
 */
export function readMonacoPalette(read: (property: string) => string): MonacoPalette {
    const palette = { ...FALLBACK_PALETTE };

    for (const key of Object.keys(MONACO_PALETTE_TOKENS) as (keyof MonacoPalette)[]) {
        const color = cssColorToHex(read(MONACO_PALETTE_TOKENS[key]));

        if (color) {
            palette[key] = color;
        }
    }

    return palette;
}

/**
 * Dérive le thème Monaco de la palette de l'application.
 *
 * La base (`vs` / `vs-dark`) suit la luminosité du fond : elle fixe les couleurs
 * que la palette ne couvre pas (widgets de suggestion, barres de défilement).
 *
 * @param palette - Couleurs du thème courant.
 */
export function buildMonacoTheme(palette: MonacoPalette): MonacoThemeDefinition {
    const bare = (hex: string): string => hex.slice(1);

    return {
        base: isDarkColor(palette.background) ? "vs-dark" : "vs",
        inherit: true,
        rules: [
            { token: "", foreground: bare(palette.text) },
            { token: "keyword", foreground: bare(palette.keyword), fontStyle: "bold" },
            { token: "operator.sql", foreground: bare(palette.keyword) },
            { token: "string", foreground: bare(palette.string) },
            { token: "number", foreground: bare(palette.number) },
            { token: "comment", foreground: bare(palette.comment), fontStyle: "italic" },
            { token: "predefined", foreground: bare(palette.function) },
            { token: "identifier", foreground: bare(palette.text) },
            { token: "delimiter", foreground: bare(palette.text) },
        ],
        colors: {
            "editor.background": palette.background,
            "editor.foreground": palette.text,
            "editorGutter.background": palette.gutterBackground,
            "editorLineNumber.foreground": palette.gutter,
            "editorLineNumber.activeForeground": palette.textMuted,
            "editorCursor.foreground": palette.text,
            "editor.selectionBackground": palette.selection,
            "editor.inactiveSelectionBackground": palette.selection,
            "editor.lineHighlightBackground": palette.lineHighlight,
            "editor.lineHighlightBorder": palette.lineHighlight,
            "editorIndentGuide.background1": palette.border,
            "editorWidget.border": palette.border,
            "focusBorder": palette.accent,
        },
    };
}
