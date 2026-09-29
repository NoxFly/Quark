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

/** Onglets conservés et index de l'onglet actif qui en résulte. */
export interface RetainedTabs<T> {
    tabs: T[];
    activeIndex: number;
}

/**
 * Ne garde que les onglets qui satisfont `keep` (après un rechargement du
 * schéma : tables disparues). L'onglet actif le reste s'il est conservé ; sinon
 * son voisin prend le relais, celui qui suit ou, à défaut, le dernier restant,
 * comme à la fermeture d'un onglet.
 * @param tabs - Onglets ouverts, dans l'ordre.
 * @param activeIndex - Index de l'onglet actif (-1 : aucun).
 * @param keep - Indique si un onglet est conservé.
 */
export function retainTabs<T>(tabs: readonly T[], activeIndex: number, keep: (tab: T) => boolean): RetainedTabs<T> {
    const kept: T[] = [];
    let nextActive = -1;

    tabs.forEach((tab, index) => {
        if (!keep(tab)) {
            return;
        }

        // Premier onglet conservé à partir de l'actif : l'actif lui-même, ou son voisin suivant.
        if (activeIndex >= 0 && nextActive === -1 && index >= activeIndex) {
            nextActive = kept.length;
        }

        kept.push(tab);
    });

    if (activeIndex >= 0 && nextActive === -1) {
        nextActive = kept.length - 1;
    }

    return { tabs: kept, activeIndex: nextActive };
}
