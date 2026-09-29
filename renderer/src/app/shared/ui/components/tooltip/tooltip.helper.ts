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

/** Rectangle de l'élément hôte, dans le repère de la fenêtre. */
export interface TooltipAnchorRect {
    left: number;
    top: number;
    width: number;
    bottom: number;
}

/** Dimensions (tooltip ou zone visible de la fenêtre). */
export interface TooltipSize {
    width: number;
    height: number;
}

/** Position calculée du coin haut-gauche du tooltip. */
export interface TooltipPosition {
    x: number;
    y: number;
}

/** Écart entre l'hôte et le tooltip. */
const TOOLTIP_GAP = 6;

/** Marge minimale entre le tooltip et les bords de la fenêtre. */
const TOOLTIP_VIEWPORT_MARGIN = 4;

/**
 * Place le tooltip sous l'hôte, centré ; le recale dans la fenêtre
 * horizontalement et le bascule au-dessus s'il déborde en bas.
 */
export function computeTooltipPosition(anchor: TooltipAnchorRect, tooltip: TooltipSize, viewport: TooltipSize): TooltipPosition {
    const maxX = viewport.width - tooltip.width - TOOLTIP_VIEWPORT_MARGIN;
    const centeredX = anchor.left + anchor.width / 2 - tooltip.width / 2;
    const x = Math.max(TOOLTIP_VIEWPORT_MARGIN, Math.min(maxX, centeredX));

    let y = anchor.bottom + TOOLTIP_GAP;

    if (y + tooltip.height > viewport.height) {
        y = Math.max(TOOLTIP_VIEWPORT_MARGIN, anchor.top - tooltip.height - TOOLTIP_GAP);
    }

    return { x, y };
}

/** Propriétaire du tooltip visible, capable de le masquer. */
export interface TooltipOwner {
    hide(): void;
}

/**
 * Garantit qu'un seul tooltip est visible à la fois dans la fenêtre : prendre
 * la place masque le propriétaire précédent, même si ses événements de sortie
 * ont été perdus (hôte déplacé, pointeur capturé, etc.).
 */
export class TooltipSlot {
    private owner: TooltipOwner | null = null;

    /**
     * @description Réserve la place pour `owner` et masque le tooltip précédent.
     */
    public claim(owner: TooltipOwner): void {
        const previous = this.owner;
        this.owner = owner;

        if (previous && previous !== owner) {
            previous.hide();
        }
    }

    /**
     * @description Libère la place si `owner` l'occupe encore.
     */
    public release(owner: TooltipOwner): void {
        if (this.owner === owner) {
            this.owner = null;
        }
    }

    /**
     * @description Indique si `owner` occupe la place.
     */
    public isOwner(owner: TooltipOwner): boolean {
        return this.owner === owner;
    }
}
