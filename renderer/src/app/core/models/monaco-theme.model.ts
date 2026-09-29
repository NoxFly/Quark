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

/**
 * Couleurs du thème courant de l'application, au format `#rrggbb`, dont est
 * dérivé le thème de Monaco. Chaque champ correspond à un design token CSS.
 */
export interface MonacoPalette {
    /** `--text` */
    text: string;
    /** `--text-muted` */
    textMuted: string;
    /** `--bg-subtle` : fond de la zone d'édition. */
    background: string;
    /** `--bg-panel` : fond de la gouttière. */
    gutterBackground: string;
    /** `--syntax-gutter` : numéros de ligne. */
    gutter: string;
    /** `--bg-selected` */
    selection: string;
    /** `--bg-row-hover` : ligne du curseur. */
    lineHighlight: string;
    /** `--border-muted` */
    border: string;
    /** `--accent` */
    accent: string;
    /** `--syntax-keyword` */
    keyword: string;
    /** `--syntax-string` */
    string: string;
    /** `--syntax-number` */
    number: string;
    /** `--syntax-comment` */
    comment: string;
    /** `--syntax-function` */
    function: string;
}

/** Règle de coloration d'un jeton, au format attendu par Monaco (couleur sans `#`). */
export interface MonacoTokenRule {
    token: string;
    foreground?: string;
    fontStyle?: string;
}

/**
 * Définition de thème Monaco (`IStandaloneThemeData`), redéclarée pour que le
 * helper qui la construit reste testable sans charger Monaco.
 */
export interface MonacoThemeDefinition {
    base: "vs" | "vs-dark";
    inherit: boolean;
    rules: MonacoTokenRule[];
    colors: Record<string, string>;
}
