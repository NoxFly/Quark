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

import type { ShortcutDefinition } from "src/app/core/models/shell.model";

/** Touches dont le nom change selon la langue, avec leur clé de traduction. */
const TRANSLATED_KEYS: Readonly<Record<string, string>> = {
    Shift: "keys.shift",
    Enter: "keys.enter",
    Delete: "keys.delete",
    Up: "keys.up",
    Down: "keys.down",
};

/**
 * Raccourcis globaux, dans l'ordre de la modale « Raccourcis clavier ».
 * Une seule liste sert à la modale : les menus et le gestionnaire de `keydown`
 * utilisent les mêmes combinaisons neutres.
 */
export const APP_SHORTCUTS: readonly ShortcutDefinition[] = [
    { keys: "Ctrl+O", labelKey: "shortcuts.open" },
    { keys: "Ctrl+Shift+C", labelKey: "shortcuts.connections" },
    { keys: "Ctrl+R", labelKey: "shortcuts.recentDb" },
    { keys: "Ctrl+Shift+N", labelKey: "shortcuts.newWindow" },
    { keys: "F5", labelKey: "shortcuts.refreshDb" },
    { keys: "Ctrl+W", labelKey: "shortcuts.closeTab" },
    { keys: "Ctrl+K Ctrl+F", labelKey: "shortcuts.closeFile" },
    { keys: "Ctrl+Shift+S", labelKey: "shortcuts.sqlEditor" },
    { keys: "Ctrl+Enter", labelKey: "shortcuts.executeSql" },
    { keys: "Ctrl+Up / Ctrl+Down", labelKey: "shortcuts.sqlHistory" },
    { keys: "Ctrl+Shift+D", labelKey: "shortcuts.erDiagram" },
    { keys: "Ctrl+Shift+M", labelKey: "shortcuts.sessionDiff" },
    { keys: "Ctrl+P", labelKey: "shortcuts.entitySearch" },
    { keys: "Ctrl+E", labelKey: "shortcuts.toggleEditMode" },
    { keys: "Ctrl+N", labelKey: "shortcuts.newRecord" },
    { keys: "Delete", labelKey: "shortcuts.deleteSelection" },
    { keys: "Ctrl+Z", labelKey: "shortcuts.undo" },
    { keys: "Ctrl+Y", labelKey: "shortcuts.redo" },
    { keys: "Ctrl+T", labelKey: "shortcuts.startTransaction" },
    { keys: "Ctrl+Enter", labelKey: "shortcuts.commitTransaction" },
    { keys: "Ctrl+Shift+Z", labelKey: "shortcuts.rollbackTransaction" },
    { keys: "F11", labelKey: "shortcuts.fullscreen" },
    { keys: "Ctrl+,", labelKey: "shortcuts.settings" },
    { keys: "Ctrl+K Ctrl+T", labelKey: "shortcuts.changeTheme" },
    { keys: "Ctrl+/", labelKey: "shortcuts.showShortcuts" },
    { keys: "Ctrl+Alt+R", labelKey: "shortcuts.reload" },
    { keys: "Alt+F4", labelKey: "shortcuts.quit" },
];

/**
 * @description Traduit une combinaison neutre pour l'affichage (« Ctrl+Shift+Enter » → « Ctrl+Maj+Entrée »).
 * Les accords (`Ctrl+K Ctrl+T`) et les alternatives (`A / B`) sont conservés.
 * @param keys Combinaison neutre, touches séparées par `+`.
 * @param translate Fonction de traduction (`I18nService.t`).
 * @returns La combinaison affichable dans la langue courante.
 * @example formatShortcut("Ctrl+Shift+C", key => i18n.t(key)); // « Ctrl+Maj+C »
 */
export function formatShortcut(keys: string, translate: (key: string) => string): string {
    return keys
        .split(" ")
        .map(chunk => chunk
            .split("+")
            .map(key => {
                const translationKey = TRANSLATED_KEYS[key];
                return translationKey ? translate(translationKey) : key;
            })
            .join("+"))
        .join(" ");
}

/**
 * @description Indique si l'élément ciblé par un évènement clavier saisit du texte
 * (champ, zone de texte, éditeur Monaco, contenu éditable) : les raccourcis
 * globaux sans modificateur ne doivent alors pas s'appliquer.
 * @param target Cible de l'évènement.
 * @returns `true` si la touche est destinée à la saisie.
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
        return false;
    }

    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}
