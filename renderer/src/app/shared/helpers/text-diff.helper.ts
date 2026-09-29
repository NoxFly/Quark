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

/** Fragment d'une valeur, marqué ou non comme différent de l'autre côté. */
export interface DiffSegment {
    /** Texte du fragment. */
    text: string;
    /** Le fragment n'existe que de ce côté du diff. */
    changed: boolean;
}

/** Découpage des deux côtés d'une valeur en fragments communs et fragments propres. */
export interface InlineDiff {
    /** Fragments du côté gauche (état d'origine). */
    before: DiffSegment[];
    /** Fragments du côté droit (état courant). */
    after: DiffSegment[];
}

/**
 * Découpage en mots, nombres, espaces et ponctuation.
 *
 * Diffé caractère par caractère, `2026-08-27` contre `2026-09-27` produirait un
 * bruit illisible ; découpé en jetons, seul le fragment réellement différent
 * ressort.
 */
const TOKEN_PATTERN = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;

/**
 * Plafond du produit des longueurs au-delà duquel la comparaison fine est
 * abandonnée. La table de programmation dynamique est en O(n × m) : sur deux
 * valeurs de plusieurs milliers de jetons, elle bloquerait le rendu pour un gain
 * de lisibilité nul.
 */
const MAX_DIFF_CELLS = 120_000;

/**
 * Compare deux valeurs textuelles et retourne, pour chaque côté, la suite de
 * fragments communs et de fragments propres.
 *
 * @param before - Valeur d'origine.
 * @param after - Valeur courante.
 * @returns Les fragments des deux côtés, dans l'ordre du texte.
 * @example
 * diffInline("contact@old.fr", "contact@new.fr");
 * // before: [{ "contact@", false }, { "old", true }, { ".fr", false }]
 * // after:  [{ "contact@", false }, { "new", true }, { ".fr", false }]
 */
export function diffInline(before: string, after: string): InlineDiff {
    if (before === after) {
        return {
            before: [{ text: before, changed: false }],
            after: [{ text: after, changed: false }],
        };
    }

    const beforeTokens = tokenize(before);
    const afterTokens = tokenize(after);

    if (beforeTokens.length * afterTokens.length > MAX_DIFF_CELLS) {
        return wholeValueDiff(before, after);
    }

    const lcs = buildLcsTable(beforeTokens, afterTokens);
    const beforeSegments: DiffSegment[] = [];
    const afterSegments: DiffSegment[] = [];

    const width = afterTokens.length + 1;
    let i = 0;
    let j = 0;

    while (i < beforeTokens.length && j < afterTokens.length) {
        if (beforeTokens[i] === afterTokens[j]) {
            beforeSegments.push({ text: beforeTokens[i] ?? "", changed: false });
            afterSegments.push({ text: afterTokens[j] ?? "", changed: false });
            i++;
            j++;
            continue;
        }

        const skipBefore = lcs[(i + 1) * width + j] ?? 0;
        const skipAfter = lcs[i * width + (j + 1)] ?? 0;

        if (skipBefore >= skipAfter) {
            beforeSegments.push({ text: beforeTokens[i] ?? "", changed: true });
            i++;
        }
        else {
            afterSegments.push({ text: afterTokens[j] ?? "", changed: true });
            j++;
        }
    }

    while (i < beforeTokens.length) {
        beforeSegments.push({ text: beforeTokens[i] ?? "", changed: true });
        i++;
    }

    while (j < afterTokens.length) {
        afterSegments.push({ text: afterTokens[j] ?? "", changed: true });
        j++;
    }

    return {
        before: mergeSegments(beforeSegments),
        after: mergeSegments(afterSegments),
    };
}

/**
 * Produit un fragment unique par côté, entièrement marqué comme différent.
 * Utilisé comme repli quand la comparaison fine serait trop coûteuse.
 */
function wholeValueDiff(before: string, after: string): InlineDiff {
    return {
        before: [{ text: before, changed: true }],
        after: [{ text: after, changed: true }],
    };
}

/**
 * Découpe une valeur en jetons comparables.
 */
function tokenize(value: string): string[] {
    return value.match(TOKEN_PATTERN) ?? [];
}

/**
 * Construit la table des longueurs de plus longue sous-suite commune, remplie
 * depuis la fin pour être parcourue depuis le début lors de la reconstruction.
 */
function buildLcsTable(before: string[], after: string[]): Uint32Array {
    const height = before.length + 1;
    const width = after.length + 1;
    const table = new Uint32Array(height * width);

    for (let i = before.length - 1; i >= 0; i--) {
        for (let j = after.length - 1; j >= 0; j--) {
            if (before[i] === after[j]) {
                table[i * width + j] = (table[(i + 1) * width + (j + 1)] ?? 0) + 1;
            }
            else {
                table[i * width + j] = Math.max(
                    table[(i + 1) * width + j] ?? 0,
                    table[i * width + (j + 1)] ?? 0,
                );
            }
        }
    }

    return table;
}

/**
 * Fusionne les fragments consécutifs de même nature, pour ne pas produire un
 * élément DOM par jeton.
 */
function mergeSegments(segments: DiffSegment[]): DiffSegment[] {
    const merged: DiffSegment[] = [];

    for (const segment of segments) {
        const last = merged[merged.length - 1];

        if (last && last.changed === segment.changed) {
            last.text += segment.text;
            continue;
        }

        merged.push({ ...segment });
    }

    return merged;
}
