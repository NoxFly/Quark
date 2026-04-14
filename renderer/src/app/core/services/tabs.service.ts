/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import { Injectable, signal, computed } from "@angular/core";

/**
 * Représente l'état d'un onglet de table ouvert.
 */
export interface TableTab {
    /** Nom de la table. */
    tableName: string;
    /** Filtre actuel de la table. */
    filter: string;
    /** Mode du filtre (SQLite ou full-text). */
    sqliteFilterMode: boolean;
    /** Colonne de tri. */
    orderBy: string | null;
    /** Sens de tri. */
    orderDir: "ASC" | "DESC";
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
            sqliteFilterMode: false,
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
