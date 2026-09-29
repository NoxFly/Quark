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

import { Injectable, signal, computed } from "@angular/core";

/**
 * Représente l'état d'un onglet de table ouvert.
 */
export interface TableTab {
    /** Nom de la table, ou "__sql-editor__" pour l'éditeur SQL. */
    tableName: string;
    /** Filtre actuel de la table. */
    filter: string;
    /** Mode du filtre (SQLite ou full-text). */
    sqlFilterMode: boolean;
    /** Colonne de tri. */
    orderBy: string | null;
    /** Sens de tri. */
    orderDir: "ASC" | "DESC";
}

/** Identifiant spécial pour l'onglet SQL Editor. */
export const SQL_EDITOR_TAB_ID = "__sql-editor__";

/** Identifiant spécial pour l'onglet du diff de session. */
export const SESSION_DIFF_TAB_ID = "__session-diff__";

/** Identifiant spécial pour l'onglet du diagramme entité-relation. */
export const ER_DIAGRAM_TAB_ID = "__er-diagram__";

/**
 * Onglet qui n'affiche pas une table mais une vue dédiée.
 * Décrit ici plutôt que dispersé en conditions dans chaque composant.
 */
export interface SpecialTab {
    /** Identifiant utilisé comme `tableName` de l'onglet. */
    id: string;
    /** Route du dashboard vers laquelle basculer. */
    route: string;
    /** Clé de traduction du libellé. */
    labelKey: string;
    /** Glyphe Segoe Fluent Icons affiché devant le libellé. */
    icon: string;
    /** Paramètres du libellé (ex. `{ table }` pour « Index · table »). */
    labelParams?: Record<string, string>;
}

/**
 * Préfixe des onglets d'index : un onglet par table, `__indexes__:<table>`.
 * Contrairement aux autres onglets spéciaux, son identifiant porte donc un paramètre.
 */
export const INDEXES_TAB_PREFIX = "__indexes__:";

/** Route de l'onglet des index, la table est lue dans l'identifiant de l'onglet actif. */
const INDEXES_TAB_ROUTE = "/dashboard/indexes";

/**
 * Retourne l'identifiant de l'onglet des index d'une table.
 * @param table - Nom de la table.
 */
export function indexesTabId(table: string): string {
    return `${INDEXES_TAB_PREFIX}${table}`;
}

/**
 * Retourne la table d'un onglet d'index, ou `null` pour tout autre onglet.
 * @param tabId - Identifiant porté par l'onglet.
 */
export function indexesTabTable(tabId: string | null | undefined): string | null {
    if (!tabId?.startsWith(INDEXES_TAB_PREFIX)) {
        return null;
    }

    return tabId.slice(INDEXES_TAB_PREFIX.length);
}

const SPECIAL_TABS: readonly SpecialTab[] = [
    { id: SQL_EDITOR_TAB_ID, route: "/dashboard/sql-editor", labelKey: "tabs.sqlEditor", icon: "\uE943" },
    { id: SESSION_DIFF_TAB_ID, route: "/dashboard/session-diff", labelKey: "tabs.sessionDiff", icon: "\uE81C" },
    { id: ER_DIAGRAM_TAB_ID, route: "/dashboard/er-diagram", labelKey: "tabs.erDiagram", icon: "\uE9D9" },
];

/**
 * Retourne la définition de l'onglet spécial correspondant, ou `null` s'il
 * s'agit d'un onglet de table ordinaire.
 * @param tableName - Identifiant porté par l'onglet.
 */
export function getSpecialTab(tableName: string | null): SpecialTab | null {
    if (tableName === null) {
        return null;
    }

    const indexedTable = indexesTabTable(tableName);

    if (indexedTable !== null) {
        return {
            id: tableName,
            route: INDEXES_TAB_ROUTE,
            labelKey: "tabs.indexes",
            icon: "",
            labelParams: { table: indexedTable },
        };
    }

    return SPECIAL_TABS.find(tab => tab.id === tableName) ?? null;
}

/**
 * Gère les onglets de tables ouverts dans le dashboard.
 * Permet de naviguer entre plusieurs tables sans perdre l'état de chacune.
 */
@Injectable({ providedIn: "root" })
export class TabsService {
    private readonly tabs = signal<TableTab[]>([]);
    private readonly activeIndex = signal<number>(-1);

    /** Liste des onglets ouverts. */
    public readonly openTabs = computed(() => this.tabs());

    /** Index de l'onglet actif. */
    public readonly activeTabIndex = computed(() => this.activeIndex());

    /** L'onglet actif, ou null si aucun. */
    public readonly activeTab = computed(() => {
        const idx = this.activeIndex();
        const tabs = this.tabs();
        return idx >= 0 && idx < tabs.length ? tabs[idx] : null;
    });

    /** Retourne true si un onglet pour cette table est déjà ouvert. */
    public hasTab(tableName: string): boolean {
        return this.tabs().some(t => t.tableName === tableName);
    }

    /** Retourne l'index de l'onglet pour une table donnée, ou -1. */
    public findTab(tableName: string): number {
        return this.tabs().findIndex(t => t.tableName === tableName);
    }

    /**
     * Ouvre un onglet pour une table.
     * Si un onglet existe déjà pour cette table, le rend actif.
     * Sinon, crée un nouvel onglet.
     * @returns L'index de l'onglet (actif après l'opération).
     */
    public openTab(tableName: string): number {
        const existing = this.findTab(tableName);
        if (existing >= 0) {
            this.activeIndex.set(existing);
            return existing;
        }

        const newTab: TableTab = {
            tableName,
            filter: "",
            sqlFilterMode: false,
            orderBy: null,
            orderDir: "ASC",
        };

        this.tabs.update(tabs => [...tabs, newTab]);
        const newIndex = this.tabs().length - 1;
        this.activeIndex.set(newIndex);
        return newIndex;
    }

    /**
     * Ferme l'onglet à l'index donné.
     * @returns Le nom de la table pour laquelle l'onglet adjacent doit devenir actif, ou null si aucun onglet ne reste.
     */
    public closeTab(index: number): string | null {
        const tabs = this.tabs();
        if (index < 0 || index >= tabs.length) {
            return null;
        }

        this.tabs.update(t => t.filter((_, i) => i !== index));

        const remaining = this.tabs();

        if (remaining.length === 0) {
            this.activeIndex.set(-1);
            return null;
        }

        // Activer l'onglet précédent ou le nouveau dernier
        const nextIndex = Math.min(index, remaining.length - 1);
        this.activeIndex.set(nextIndex);
        return remaining[nextIndex]?.tableName ?? null;
    }

    /**
     * Passe à l'onglet à l'index donné.
     */
    public switchTab(index: number): void {
        const tabs = this.tabs();
        if (index >= 0 && index < tabs.length) {
            this.activeIndex.set(index);
        }
    }

    /**
     * Met à jour l'état de l'onglet actif (filtre, tri…).
     */
    public updateActiveTab(partial: Partial<Omit<TableTab, "tableName">>): void {
        const idx = this.activeIndex();
        if (idx < 0) {
            return;
        }

        this.tabs.update(tabs => tabs.map((tab, i) =>
            i === idx ? { ...tab, ...partial } : tab
        ));
    }

    /**
     * Ferme tous les onglets (ex: à la fermeture de la base).
     */
    public closeAll(): void {
        this.tabs.set([]);
        this.activeIndex.set(-1);
    }

    /**
     * Réordonne les onglets par drag & drop.
     * @param fromIndex - Index source.
     * @param toIndex - Index de destination.
     */
    public reorderTab(fromIndex: number, toIndex: number): void {
        const tabs = this.tabs();
        if (
            fromIndex === toIndex
            || fromIndex < 0 || toIndex < 0
            || fromIndex >= tabs.length || toIndex >= tabs.length
        ) {
            return;
        }

        const newTabs = [...tabs];
        const [moved] = newTabs.splice(fromIndex, 1);
        if (moved) {
            newTabs.splice(toIndex, 0, moved);
        }

        // Recalculer l'index actif après le réordonnancement
        const activeIdx = this.activeIndex();
        let newActiveIdx = activeIdx;
        if (activeIdx === fromIndex) {
            newActiveIdx = toIndex;
        }
        else if (fromIndex < activeIdx && toIndex >= activeIdx) {
            newActiveIdx = activeIdx - 1;
        }
        else if (fromIndex > activeIdx && toIndex <= activeIdx) {
            newActiveIdx = activeIdx + 1;
        }

        this.tabs.set(newTabs);
        this.activeIndex.set(newActiveIdx);
    }
}
