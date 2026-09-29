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

/**
 * Élément d'un menu de la titlebar.
 */
export interface MenuItem {
    /** Libellé déjà traduit. */
    label: string;
    /** Raccourci affiché à droite, déjà formaté pour la langue courante. */
    shortcut?: string;
    /** Élément à cocher : `true`/`false` affiche l'état, absent pour une simple action. */
    checked?: boolean;
    /** Action exécutée au clic. */
    action?: () => void;
    /** Séparateur horizontal (les autres champs sont ignorés). */
    separator?: boolean;
    /** Élément grisé et inactif. */
    disabled?: boolean;
    /** Sous-menu ouvert à droite au survol. */
    children?: MenuItem[];
}

/**
 * Menu déroulant de la titlebar.
 */
export interface Menu {
    /** Identifiant stable (suivi du `@for`, menu ouvert). */
    id: string;
    /** Libellé déjà traduit. */
    label: string;
    /** Éléments du menu. */
    items: MenuItem[];
}

/**
 * Raccourci clavier décrit indépendamment de la langue.
 *
 * `keys` utilise des noms de touches neutres séparés par `+` (`Ctrl+Shift+Enter`) :
 * `formatShortcut` les traduit à l'affichage (« Ctrl+Maj+Entrée »).
 */
export interface ShortcutDefinition {
    /** Combinaison neutre, ex. `Ctrl+Shift+C`. */
    keys: string;
    /** Clé de traduction du libellé. */
    labelKey: string;
}

/**
 * Option d'un contrôle segmenté de la page Paramètres.
 */
export interface SegmentOption<T extends string | number> {
    /** Valeur portée par l'option. */
    value: T;
    /** Clé de traduction du libellé (ou libellé brut si `raw`). */
    labelKey: string;
    /** Le libellé est affiché tel quel, sans traduction (nom de langue, durée). */
    raw?: boolean;
}

/**
 * Thème proposé dans les menus, la page Paramètres et le sélecteur rapide.
 */
export interface ThemeOption {
    /** Valeur persistée. */
    value: import("@shared/preferences").Theme;
    /** Clé de traduction du libellé. */
    labelKey: string;
}

/**
 * Libellés de l'état d'une transaction ouverte (bandeau et barre d'état).
 */
export interface PendingTransactionInfo {
    /** Nombre de lignes / opérations modifiées depuis le début de la transaction. */
    count: number;
    /** Tables touchées depuis le début de la transaction. */
    tables: string[];
}
