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

import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, OnInit, signal } from "@angular/core";
import type {
    SessionOpaqueChange,
    SessionRowDiff,
    SessionTableDiff,
} from "@shared/session-diff";
import type { DbRecord } from "@shared/types";
import { AlertController } from "@ui/alert/alert.controller";
import { I18nService } from "src/app/core/services/i18n.service";
import { SessionDiffService } from "src/app/core/services/session-diff.service";
import { StateService } from "src/app/core/services/state.service";
import { diffInline, type DiffSegment } from "src/app/shared/helpers/text-diff.helper";
import { TooltipDirective } from "src/app/shared/ui/components/tooltip/tooltip.directive";

/** Nombre de lignes affichées par table avant de devoir en demander davantage. */
const DEFAULT_ROW_LIMIT = 100;

/** Incrément appliqué à chaque « afficher plus ». */
const ROW_LIMIT_STEP = 200;

/** Colonnes portant l'identité de la ligne, affichées dans l'en-tête et non dans le corps. */
const IDENTITY_COLUMNS = new Set(["rowid"]);

/** Une colonne d'une ligne, dans ses deux états. */
interface ColumnDiffView {
    column: string;
    /** Fragments de la valeur d'origine, `null` si la ligne n'existait pas. */
    before: DiffSegment[] | null;
    /** Fragments de la valeur courante, `null` si la ligne a été supprimée. */
    after: DiffSegment[] | null;
    /** La valeur diffère entre les deux états. */
    changed: boolean;
}

/** Une ligne modifiée, prête à l'affichage. */
interface RowDiffView {
    rowid: number;
    kind: SessionRowDiff["kind"];
    columns: ColumnDiffView[];
    lastChangedAt: number;
}

/** Une table modifiée, prête à l'affichage. */
interface TableDiffView {
    table: string;
    /**
     * Colonnes de la table, dans un ordre commun à toutes ses lignes.
     * La vue grille aligne ses cellules dessus ; chaque `RowDiffView.columns`
     * suit exactement cette liste, y compris pour les colonnes absentes d'une ligne.
     */
    columnNames: string[];
    rows: RowDiffView[];
    inserted: number;
    updated: number;
    deleted: number;
    /** Lignes modifiées non affichées, faute de place dans la limite courante. */
    hidden: number;
}

/** Mise en page du diff. */
type DiffViewMode = "cards" | "grid";

/** Clé de persistance du mode d'affichage choisi. */
const VIEW_MODE_STORAGE_KEY = "session-diff-view";

/**
 * Page de diff de la session de connexion.
 *
 * Présente, dans une vue côte à côte de type `git diff`, l'écart entre l'état de
 * la base à son ouverture (gauche) et son état actuel (droite). Le périmètre est
 * la session entière : le mode transaction n'y change rien, une modification
 * validée et une modification en attente y figurent de la même façon.
 */
@Component({
    selector: "app-session-diff-page",
    standalone: true,
    templateUrl: "./session-diff.page.html",
    styleUrl: "./session-diff.page.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [TooltipDirective],
})
export class SessionDiffPage implements OnInit, OnDestroy {
    protected readonly sessionDiff = inject(SessionDiffService);
    protected readonly i18n = inject(I18nService);
    protected readonly state = inject(StateService);
    private readonly alertCtrl = inject(AlertController);

    /** Limite d'affichage par table, au-delà de la valeur par défaut. */
    private readonly rowLimits = signal<Record<string, number>>({});

    /** Tables repliées par l'utilisateur. */
    private readonly collapsed = signal<Set<string>>(new Set());

    /** Filtre sur le nom de table. */
    protected readonly tableFilter = signal<string>("");

    /**
     * Mise en page du diff, restaurée du choix précédent.
     *
     * La grille aligne les champs horizontalement, à la manière des tables de la
     * base ; les fiches gardent chaque ligne lisible quand la table est large.
     */
    protected readonly viewMode = signal<DiffViewMode>(readStoredViewMode());

    protected readonly snapshot = computed(() => this.sessionDiff.snapshot());

    /**
     * Vrai tant qu'aucun instantané n'a été chargé. Le bandeau d'erreur, affiché
     * au-dessus, prend le relais si le chargement a échoué : le corps ne reste
     * jamais vide sans explication.
     */
    protected readonly initializing = computed(() => this.snapshot() === null);

    protected readonly opaqueChanges = computed<SessionOpaqueChange[]>(() => this.snapshot()?.opaque ?? []);

    protected readonly isEmpty = computed(() => {
        const snapshot = this.snapshot();

        if (!snapshot) {
            return false;
        }

        return snapshot.summary.rows === 0 && snapshot.summary.opaque === 0;
    });

    /**
     * Modèle d'affichage complet.
     *
     * Le découpage fin des valeurs est fait ici, une seule fois par instantané :
     * le calculer depuis le template le relancerait à chaque détection de changement.
     */
    protected readonly tables = computed<TableDiffView[]>(() => {
        const snapshot = this.snapshot();

        if (!snapshot) {
            return [];
        }

        const filter = this.tableFilter().trim().toLowerCase();
        const limits = this.rowLimits();

        return snapshot.tables
            .filter(table => filter.length === 0 || table.table.toLowerCase().includes(filter))
            .map(table => this.buildTableView(table, limits[table.table] ?? DEFAULT_ROW_LIMIT));
    });

    /**
     *
     */
    public ngOnInit(): void {
        this.sessionDiff.setLive(true);
    }

    /**
     *
     */
    public ngOnDestroy(): void {
        this.sessionDiff.setLive(false);
    }

    /**
     * Change la mise en page et retient le choix pour les prochaines ouvertures.
     */
    protected setViewMode(mode: DiffViewMode): void {
        this.viewMode.set(mode);

        try {
            localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
        }
        catch {
            // Stockage indisponible : le choix vaut pour la session, sans plus.
        }
    }

    /**
     * Indique si une table est repliée.
     */
    protected isCollapsed(table: string): boolean {
        return this.collapsed().has(table);
    }

    /**
     * Plie ou déplie une table.
     */
    protected toggleTable(table: string): void {
        this.collapsed.update(current => {
            const next = new Set(current);

            if (!next.delete(table)) {
                next.add(table);
            }

            return next;
        });
    }

    /**
     * Augmente le nombre de lignes affichées pour une table.
     */
    protected showMore(table: string, current: number): void {
        this.rowLimits.update(limits => ({ ...limits, [table]: current + ROW_LIMIT_STEP }));
    }

    /**
     * Recharge l'instantané depuis le processus principal.
     */
    protected async refresh(): Promise<void> {
        await this.sessionDiff.load();
    }

    /**
     * Efface le journal après confirmation. N'annule aucune modification en base :
     * la confirmation le rappelle explicitement, la nuance est facile à manquer.
     */
    protected async confirmClear(): Promise<void> {
        await this.alertCtrl.create({
            title: this.i18n.t("sessionDiff.clearTitle"),
            message: this.i18n.t("sessionDiff.clearMessage"),
            color: "warning",
            actions: [
                { text: this.i18n.t("sessionDiff.cancel"), role: "cancel" },
                {
                    text: this.i18n.t("sessionDiff.clearConfirm"),
                    role: "destructive",
                    color: "danger",
                    handler: self => {
                        self.dismiss({ role: "destructive" });
                        void this.sessionDiff.clear();
                    },
                },
            ],
        });
    }

    /**
     * Formate un horodatage pour l'affichage.
     */
    protected formatTime(timestamp: number): string {
        return new Date(timestamp).toLocaleTimeString(this.i18n.locale());
    }

    // --- Construction du modèle d'affichage ---

    /**
     * Projette une table du journal vers son modèle d'affichage.
     */
    private buildTableView(table: SessionTableDiff, limit: number): TableDiffView {
        const visible = table.rows.slice(0, limit);

        // Les colonnes sont unifiées au niveau de la table, pas de la ligne : la
        // vue grille aligne toutes ses lignes sur les mêmes en-têtes, et une
        // colonne ajoutée en cours de session ne doit pas décaler les autres.
        const columnNames = unionColumns(visible);

        return {
            table: table.table,
            columnNames,
            rows: visible.map(row => this.buildRowView(row, columnNames)),
            inserted: table.inserted,
            updated: table.updated,
            deleted: table.deleted,
            hidden: table.rows.length - visible.length,
        };
    }

    /**
     * Projette une ligne du journal vers son modèle d'affichage.
     * @param row - Ligne du journal.
     * @param columnNames - Colonnes de la table, dans leur ordre commun.
     */
    private buildRowView(row: SessionRowDiff, columnNames: string[]): RowDiffView {
        const changed = new Set(row.changedColumns);

        return {
            rowid: row.rowid,
            kind: row.kind,
            lastChangedAt: row.lastChangedAt,
            columns: columnNames.map(column => this.buildColumnView(row, column, changed.has(column))),
        };
    }

    /**
     * Projette une colonne vers ses deux états.
     *
     * Le découpage fin n'a de sens que sur une modification : sur une insertion
     * ou une suppression, la ligne entière est nouvelle ou disparue, souligner
     * des fragments à l'intérieur n'apprendrait rien.
     */
    private buildColumnView(row: SessionRowDiff, column: string, isChanged: boolean): ColumnDiffView {
        // `null` couvre les deux absences : la ligne n'existe pas de ce côté, ou
        // la colonne n'y existe pas — une colonne ajoutée en cours de session
        // n'a pas de valeur d'origine, et ce n'est pas la même chose que NULL.
        const beforeText = readCell(row.before, column);
        const afterText = readCell(row.after, column);

        if (beforeText === null || afterText === null) {
            return {
                column,
                before: beforeText === null ? null : [{ text: beforeText, changed: true }],
                after: afterText === null ? null : [{ text: afterText, changed: true }],
                changed: true,
            };
        }

        if (!isChanged) {
            return {
                column,
                before: [{ text: beforeText, changed: false }],
                after: [{ text: afterText, changed: false }],
                changed: false,
            };
        }

        const inline = diffInline(beforeText, afterText);

        return { column, before: inline.before, after: inline.after, changed: true };
    }
}

/**
 * Retourne les colonnes couvrant toutes les lignes données, dans l'ordre de la
 * base et sans doublon.
 *
 * Les deux états de chaque ligne sont parcourus : une colonne ajoutée en cours
 * de session n'existe que du côté droit, une colonne supprimée que du gauche.
 */
function unionColumns(rows: SessionRowDiff[]): string[] {
    const columns: string[] = [];
    const seen = new Set<string>();

    for (const row of rows) {
        for (const record of [row.before, row.after]) {
            if (!record) {
                continue;
            }

            for (const column of Object.keys(record)) {
                if (IDENTITY_COLUMNS.has(column) || seen.has(column)) {
                    continue;
                }

                seen.add(column);
                columns.push(column);
            }
        }
    }

    return columns;
}

/**
 * Lit une cellule et la formate, ou retourne `null` si l'enregistrement ou la
 * colonne n'existe pas de ce côté du diff.
 */
function readCell(record: DbRecord | null, column: string): string | null {
    if (!record || !(column in record)) {
        return null;
    }

    return formatCellValue(record[column]);
}

/**
 * Restaure la mise en page choisie précédemment.
 * La grille est le défaut : c'est la lecture la plus proche des tables de la base.
 */
function readStoredViewMode(): DiffViewMode {
    try {
        return localStorage.getItem(VIEW_MODE_STORAGE_KEY) === "cards" ? "cards" : "grid";
    }
    catch {
        return "grid";
    }
}

/**
 * Rend une valeur de cellule lisible dans le diff.
 *
 * Les BLOB sont réduits à leur taille : afficher leur contenu produirait des
 * milliers de caractères illisibles et ferait exploser la comparaison fine.
 */
function formatCellValue(value: unknown): string {
    if (value === null || value === undefined) {
        return "NULL";
    }

    if (value instanceof Uint8Array) {
        return `[BLOB ${value.byteLength} bytes]`;
    }

    if (typeof value === "object") {
        return JSON.stringify(value);
    }

    return String(value);
}
