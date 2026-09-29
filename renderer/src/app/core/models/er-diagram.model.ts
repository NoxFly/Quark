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

import type { TableSchema } from "@shared/types";

/** Boîte d'une table sur le diagramme, en coordonnées du plan (avant zoom). */
export interface ErTableNode {
    table: TableSchema;
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Lien d'une clé étrangère vers la table qu'elle référence. */
export interface ErFkLink {
    fromTable: string;
    fromColumn: string;
    toTable: string;
    toColumn: string;
    /** Tracé SVG (courbe de Bézier). */
    path: string;
}

/**
 * Vue sur le plan : translation en pixels écran puis mise à l'échelle.
 * Un point du plan `(px, py)` s'affiche en `(x + px × k, y + py × k)`.
 */
export interface ErViewport {
    x: number;
    y: number;
    k: number;
}

/** Glisser d'une boîte en cours. */
export interface ErNodeDrag {
    index: number;
    startMouseX: number;
    startMouseY: number;
    startNodeX: number;
    startNodeY: number;
    /** Le pointeur a dépassé la tolérance de clic. */
    moved: boolean;
    /** L'appui a commencé sur l'en-tête : un clic sans glisser ouvre la table. */
    onHeader: boolean;
}

/** Déplacement de la vue en cours. */
export interface ErViewPan {
    startMouseX: number;
    startMouseY: number;
    startX: number;
    startY: number;
}
