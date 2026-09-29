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
import { formatRelativeTime } from "src/app/shared/helpers/relative-time.helper";

const NOW = new Date(2026, 8, 29, 14, 30).getTime();

/** Intl sépare nombre et unité par des espaces insécables : on les normalise. */
function relative(timestamp: number): string {
    return formatRelativeTime(timestamp, "fr", NOW).replace(/\s/gu, " ");
}

describe("formatRelativeTime", () => {
    it("annonce un instant récent", () => {
        expect(relative(NOW - 10_000)).toBe("maintenant");
    });

    it("compte les minutes sous l'heure", () => {
        expect(relative(NOW - 5 * 60_000)).toBe("il y a 5 min");
    });

    it("compte les heures le même jour", () => {
        expect(relative(NOW - 2 * 3_600_000)).toBe("il y a 2 h");
    });

    it("dit « hier » pour la veille, même moins de 24 h avant", () => {
        const yesterdayEvening = new Date(2026, 8, 28, 23, 0).getTime();
        expect(relative(yesterdayEvening)).toBe("hier");
    });

    it("compte les jours sous la semaine", () => {
        const threeDaysAgo = new Date(2026, 8, 26, 9, 0).getTime();
        expect(relative(threeDaysAgo)).toBe("il y a 3 j");
    });

    it("affiche la date au-delà d'une semaine", () => {
        const old = new Date(2026, 7, 1, 9, 0).getTime();
        expect(relative(old)).toBe("01/08/2026");
    });

    it("ne produit jamais de date future", () => {
        expect(relative(NOW + 60_000)).toBe("maintenant");
    });
});
