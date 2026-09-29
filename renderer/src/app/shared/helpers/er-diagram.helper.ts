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
import type { ErFkLink, ErTableNode, ErViewport } from "src/app/core/models/er-diagram.model";

/** Largeur d'une boîte de table. */
export const ER_BOX_WIDTH = 220;

/** Hauteur de l'en-tête d'une boîte (nom de la table). */
export const ER_HEADER_HEIGHT = 32;

/** Hauteur d'une ligne de colonne. */
export const ER_ROW_HEIGHT = 22;

/** Bornes du zoom. */
export const ER_MIN_ZOOM = 0.3;
export const ER_MAX_ZOOM = 3;

/** Pas de la grille de points du fond, à l'échelle 1. */
export const ER_GRID_STEP = 20;

/** Espacements du placement automatique. */
const H_GAP = 60;
const V_GAP = 48;

/** Ratio largeur / hauteur visé par le placement automatique (paysage 16:9). */
const TARGET_ASPECT_RATIO = 16 / 9;

/**
 * Hauteur d'une boîte de table : en-tête puis une ligne par colonne.
 *
 * @param table - Table affichée.
 */
export function erTableHeight(table: TableSchema): number {
    return ER_HEADER_HEIGHT + table.fields.length * ER_ROW_HEIGHT;
}

/**
 * Borne un niveau de zoom.
 *
 * @param k - Zoom demandé.
 * @returns Le zoom ramené entre `ER_MIN_ZOOM` et `ER_MAX_ZOOM`.
 */
export function clampZoom(k: number): number {
    return Math.min(ER_MAX_ZOOM, Math.max(ER_MIN_ZOOM, k));
}

/**
 * Zoome en gardant fixe le point du plan situé sous le pointeur.
 *
 * @param view - Vue courante.
 * @param factor - Facteur multiplicatif (> 1 : rapprocher).
 * @param pointerX - Abscisse du pointeur dans le cadre du diagramme.
 * @param pointerY - Ordonnée du pointeur dans le cadre du diagramme.
 * @returns La nouvelle vue, zoom borné.
 * @example
 * zoomViewAt({ x: 0, y: 0, k: 1 }, 2, 100, 50); // { x: -100, y: -50, k: 2 }
 */
export function zoomViewAt(view: ErViewport, factor: number, pointerX: number, pointerY: number): ErViewport {
    const k = clampZoom(view.k * factor);
    const ratio = k / view.k;

    return {
        x: pointerX - (pointerX - view.x) * ratio,
        y: pointerY - (pointerY - view.y) * ratio,
        k,
    };
}

/**
 * Place les tables en grille, en choisissant le nombre de colonnes dont le
 * rapport largeur / hauteur approche le mieux le 16:9 d'une fenêtre.
 *
 * @param tables - Tables de la base.
 * @returns Une boîte par table, dans l'ordre reçu.
 */
export function layoutErNodes(tables: readonly TableSchema[]): ErTableNode[] {
    const count = tables.length;

    if (count === 0) {
        return [];
    }

    const columns = optimalColumnCount(tables);
    const rowCount = Math.ceil(count / columns);
    const rowY: number[] = [];
    let cumulativeY = V_GAP;

    // Chaque rangée prend la hauteur de sa plus haute table.
    for (let row = 0; row < rowCount; row++) {
        const rowTables = tables.slice(row * columns, (row + 1) * columns);
        const rowHeight = Math.max(...rowTables.map(erTableHeight));

        rowY.push(cumulativeY);
        cumulativeY += rowHeight + V_GAP;
    }

    return tables.map((table, index) => ({
        table,
        x: H_GAP + (index % columns) * (ER_BOX_WIDTH + H_GAP),
        y: rowY[Math.floor(index / columns)] ?? V_GAP,
        width: ER_BOX_WIDTH,
        height: erTableHeight(table),
    }));
}

/**
 * Calcule le tracé des clés étrangères entre les boîtes.
 *
 * Un lien part de la ligne de la colonne FK et arrive sur la ligne de la
 * colonne référencée (ou sur l'en-tête si elle est introuvable), par le côté
 * des boîtes qui se font face.
 *
 * @param nodes - Boîtes placées.
 */
export function computeErLinks(nodes: readonly ErTableNode[]): ErFkLink[] {
    const links: ErFkLink[] = [];
    const nodeMap = new Map(nodes.map(node => [node.table.name, node]));

    for (const source of nodes) {
        source.table.fields.forEach((field, fieldIndex) => {
            const fk = field.fk;
            const target = fk ? nodeMap.get(fk.table) : undefined;

            if (!fk || !target) {
                return;
            }

            const fromY = rowCenter(source, fieldIndex);
            const targetIndex = target.table.fields.findIndex(candidate => candidate.name === fk.column);
            const toY = targetIndex >= 0 ? rowCenter(target, targetIndex) : target.y + ER_HEADER_HEIGHT / 2;
            const targetRight = target.x + target.width;
            const sourceIsRight = source.x > targetRight;
            const fromX = sourceIsRight ? source.x : source.x + source.width;
            const toX = sourceIsRight ? targetRight : target.x;
            const midX = (fromX + toX) / 2;

            links.push({
                fromTable: source.table.name,
                fromColumn: field.name,
                toTable: fk.table,
                toColumn: fk.column,
                path: `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`,
            });
        });
    }

    return links;
}

/**
 * Ordonnée du milieu de la ligne d'une colonne.
 */
function rowCenter(node: ErTableNode, fieldIndex: number): number {
    return node.y + ER_HEADER_HEIGHT + fieldIndex * ER_ROW_HEIGHT + ER_ROW_HEIGHT / 2;
}

/**
 * Nombre de colonnes de la grille dont le rapport largeur / hauteur approche le
 * mieux `TARGET_ASPECT_RATIO`.
 */
function optimalColumnCount(tables: readonly TableSchema[]): number {
    const count = tables.length;

    if (count <= 1) {
        return 1;
    }

    const averageFields = tables.reduce((sum, table) => sum + table.fields.length, 0) / count;
    const cellWidth = ER_BOX_WIDTH + H_GAP;
    const cellHeight = ER_HEADER_HEIGHT + averageFields * ER_ROW_HEIGHT + V_GAP;
    let best = 1;
    let bestDistance = Infinity;

    for (let columns = 1; columns <= count; columns++) {
        const rows = Math.ceil(count / columns);
        const distance = Math.abs((columns * cellWidth) / (rows * cellHeight) - TARGET_ASPECT_RATIO);

        if (distance < bestDistance) {
            bestDistance = distance;
            best = columns;
        }
    }

    return best;
}
