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

import { computed, type Signal, signal } from "@angular/core";

/** Plage de lignes à rendre, fin exclue. */
export interface VirtualRange {
    start: number;
    end: number;
}

/**
 * Virtualisation verticale d'un `<table>` par lignes d'espacement.
 *
 * Seules les lignes visibles (plus une marge) sont dans le DOM ; deux lignes
 * vides, en tête et en fin de `<tbody>`, occupent la hauteur des autres. Cette
 * technique garde un vrai tableau (largeurs de colonnes partagées, en-tête
 * `sticky`), ce que ne permet pas le viewport du CDK, dont la translation du
 * contenu casse le `position: sticky` de l'en-tête.
 *
 * La hauteur de ligne n'est pas supposée : elle est mesurée sur une ligne rendue
 * (`measure`), car une estimation fausse d'un pixel décale la position de
 * plusieurs milliers de pixels au bout d'un long défilement.
 */
export class VirtualRows {
    private readonly scrollTop = signal(0);
    private readonly viewportHeight = signal(0);
    private readonly rowHeight = signal(0);

    /** Plage de lignes à rendre. */
    public readonly range: Signal<VirtualRange>;

    /** Hauteur de la ligne d'espacement de tête. */
    public readonly paddingTop: Signal<number>;

    /** Hauteur de la ligne d'espacement de fin. */
    public readonly paddingBottom: Signal<number>;

    /**
     * @param total - Nombre total de lignes chargées.
     * @param estimatedRowHeight - Hauteur utilisée tant qu'aucune ligne n'a été mesurée.
     * @param overscan - Lignes rendues en plus au-dessus et au-dessous de la zone visible.
     */
    public constructor(
        private readonly total: Signal<number>,
        estimatedRowHeight: number,
        private readonly overscan = 12,
    ) {
        this.rowHeight.set(estimatedRowHeight);

        this.range = computed(() => {
            const count = this.total();
            const height = this.rowHeight();
            // Tant que la taille du conteneur est inconnue, on rend une fenêtre
            // raisonnable plutôt que rien.
            const viewport = this.viewportHeight() || 1000;
            const first = Math.floor(this.scrollTop() / height);
            const visible = Math.ceil(viewport / height);

            return {
                start: Math.max(0, Math.min(count, first - this.overscan)),
                end: Math.min(count, first + visible + this.overscan),
            };
        }, { equal: (a, b) => a.start === b.start && a.end === b.end });

        this.paddingTop = computed(() => this.range().start * this.rowHeight());
        this.paddingBottom = computed(() => (this.total() - this.range().end) * this.rowHeight());
    }

    /**
     * À appeler sur l'événement `scroll` du conteneur.
     */
    public onScroll(container: HTMLElement): void {
        this.scrollTop.set(container.scrollTop);
        this.viewportHeight.set(container.clientHeight);
    }

    /**
     * Mesure la hauteur réelle d'une ligne rendue.
     * @param row - Une ligne de données (pas une ligne d'espacement).
     */
    public measure(row: HTMLElement | null | undefined): void {
        const height = row?.getBoundingClientRect().height ?? 0;

        if (height > 0 && Math.abs(height - this.rowHeight()) > 0.1) {
            this.rowHeight.set(height);
        }
    }

    /**
     * Revient en haut, par exemple au changement de table.
     */
    public reset(container: HTMLElement | null | undefined): void {
        if (container) {
            container.scrollTop = 0;
        }

        this.scrollTop.set(0);
    }

    /**
     * Fait défiler au minimum pour rendre une ligne visible.
     * @param headerHeight - Hauteur de l'en-tête `sticky`, qui masque le haut du conteneur.
     */
    public scrollToIndex(container: HTMLElement, index: number, headerHeight = 0): void {
        const height = this.rowHeight();
        const top = index * height;
        const bottom = top + height;
        const visibleTop = container.scrollTop;
        const visibleBottom = visibleTop + container.clientHeight - headerHeight;

        if (top < visibleTop) {
            container.scrollTop = top;
        }
        else if (bottom > visibleBottom) {
            container.scrollTop = bottom - container.clientHeight + headerHeight;
        }

        this.onScroll(container);
    }

    /**
     * Indique si la fin de la plage rendue approche de la fin des lignes
     * chargées : le moment de charger la page suivante.
     */
    public isNearEnd(threshold = 50): boolean {
        return this.range().end >= this.total() - threshold;
    }
}
