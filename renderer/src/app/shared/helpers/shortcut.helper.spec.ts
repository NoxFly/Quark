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
import { fr } from "src/app/core/i18n/fr";
import { APP_SHORTCUTS, formatShortcut } from "src/app/shared/helpers/shortcut.helper";

const translate = (key: string): string => fr[key] ?? key;

describe("formatShortcut", () => {
    it("traduit les touches nommées à la française", () => {
        expect(formatShortcut("Ctrl+Shift+C", translate)).toBe("Ctrl+Maj+C");
        expect(formatShortcut("Ctrl+Enter", translate)).toBe("Ctrl+Entrée");
        expect(formatShortcut("Delete", translate)).toBe("Suppr");
    });

    it("conserve les accords et les alternatives", () => {
        expect(formatShortcut("Ctrl+K Ctrl+T", translate)).toBe("Ctrl+K Ctrl+T");
        expect(formatShortcut("Ctrl+Up / Ctrl+Down", translate)).toBe("Ctrl+↑ / Ctrl+↓");
    });

    it("laisse intactes les touches sans traduction", () => {
        expect(formatShortcut("F11", translate)).toBe("F11");
        expect(formatShortcut("Ctrl+/", translate)).toBe("Ctrl+/");
    });
});

describe("APP_SHORTCUTS", () => {
    it("a un libellé traduit pour chaque raccourci", () => {
        const missing = APP_SHORTCUTS.filter(shortcut => fr[shortcut.labelKey] === undefined);
        expect(missing).toEqual([]);
    });
});
