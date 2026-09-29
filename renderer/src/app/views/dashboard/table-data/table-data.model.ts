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

import type { FieldDef } from "@shared/types";

/** Colonne de la grille de données, prête pour l'affichage. */
export interface GridColumn {
    field: FieldDef;
    /** Valeurs en police à chasse fixe (types non textuels). */
    mono: boolean;
    /** La colonne peut contenir des epochs : le bouton « Afficher en date » est proposé. */
    timestampCandidate: boolean;
    /** Les valeurs sont actuellement affichées comme des dates. */
    showAsDate: boolean;
    /** Infobulle du badge FK (`→ table.colonne`), vide sans clé étrangère. */
    fkTitle: string;
}
