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

import { describe, expect, it, vi } from "vitest";
import { computeTooltipPosition, TooltipSlot } from "src/app/shared/ui/components/tooltip/tooltip.helper";

const VIEWPORT = { width: 800, height: 600 };

describe("computeTooltipPosition", () => {
    it("centre le tooltip sous l'hôte", () => {
        const position = computeTooltipPosition({ left: 100, top: 50, width: 40, bottom: 70 }, { width: 60, height: 20 }, VIEWPORT);

        expect(position).toEqual({ x: 90, y: 76 });
    });

    it("recale le tooltip dans la fenêtre à gauche et à droite", () => {
        const size = { width: 100, height: 20 };

        expect(computeTooltipPosition({ left: 0, top: 50, width: 10, bottom: 70 }, size, VIEWPORT).x).toBe(4);
        expect(computeTooltipPosition({ left: 790, top: 50, width: 10, bottom: 70 }, size, VIEWPORT).x).toBe(696);
    });

    it("bascule au-dessus quand la place manque en bas", () => {
        const position = computeTooltipPosition({ left: 100, top: 570, width: 40, bottom: 590 }, { width: 60, height: 20 }, VIEWPORT);

        expect(position.y).toBe(544);
    });
});

describe("TooltipSlot", () => {
    it("masque le propriétaire précédent quand un autre prend la place", () => {
        const slot = new TooltipSlot();
        const first = { hide: vi.fn() };
        const second = { hide: vi.fn() };

        slot.claim(first);
        slot.claim(second);

        expect(first.hide).toHaveBeenCalledOnce();
        expect(second.hide).not.toHaveBeenCalled();
        expect(slot.isOwner(second)).toBe(true);
    });

    it("ne masque pas le propriétaire qui reprend sa propre place", () => {
        const slot = new TooltipSlot();
        const owner = { hide: vi.fn() };

        slot.claim(owner);
        slot.claim(owner);

        expect(owner.hide).not.toHaveBeenCalled();
    });

    it("ignore la libération par un ancien propriétaire", () => {
        const slot = new TooltipSlot();
        const first = { hide: vi.fn() };
        const second = { hide: vi.fn() };

        slot.claim(first);
        slot.claim(second);
        slot.release(first);

        expect(slot.isOwner(second)).toBe(true);

        slot.release(second);
        expect(slot.isOwner(second)).toBe(false);
    });
});
