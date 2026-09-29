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

import {
    afterNextRender,
    afterRenderEffect,
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    DOCUMENT,
    effect,
    ElementRef,
    inject,
    Injector,
    signal,
    untracked,
    viewChild,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { DatabaseService } from "src/app/core/services/database.service";
import { I18nService } from "src/app/core/services/i18n.service";
import { SettingsService } from "src/app/core/services/settings.service";
import { StateService } from "src/app/core/services/state.service";
import { BatchEditComponent } from "src/app/shared/components/batch-edit/batch-edit.component";
import { ContextMenuComponent } from "src/app/shared/components/context-menu/context-menu.component";
import type { ContextMenuItem } from "src/app/shared/components/context-menu/context-menu.component";
import { ImportDataComponent } from "src/app/shared/components/import-data/import-data.component";
import { RecordEditorComponent } from "src/app/shared/components/record-editor/record-editor.component";
import type { RecordEditorMode } from "src/app/shared/components/record-editor/record-editor.model";
import { SchemaEditorComponent } from "src/app/shared/components/schema-editor/schema-editor.component";
import { ModalController } from "src/app/shared/ui/components/modal/modal.controller";
import type { UIDismissData } from "src/app/shared/ui/ui.types";
import type { DbRecord, FieldDef } from "@shared/types";
import { TooltipDirective } from "src/app/shared/ui/components/tooltip/tooltip.directive";
import { VirtualRows } from "src/app/shared/helpers/virtual-rows.helper";
import {
    foreignKeyFilter,
    formatEpoch,
    gridMinWidth,
    gridTemplateColumns,
    isTextType,
    isTimestampCandidate,
    rowMarksFromHistory,
    type RowMark,
} from "src/app/shared/helpers/data-grid.helper";
import type { GridColumn } from "src/app/views/dashboard/table-data/table-data.model";

/** Lignes chargées examinées pour détecter les colonnes d'epochs. */
const TIMESTAMP_SAMPLE_SIZE = 50;

/**
 * Page d'affichage des données d'une table avec :
 * - Colonnes redimensionnables (largeurs flexibles selon le type, fixes une fois redimensionnées)
 * - Édition inline des cellules (clic simple)
 * - Tri par colonne
 * - Sélection de lignes (clic, Ctrl+clic, Maj+clic)
 * - Infinite scroll, lignes virtualisées (hauteur selon la densité réglée)
 * - Mode transaction
 * - Barre de recherche texte / SQL
 */
@Component({
    selector: "app-table-data",
    standalone: true,
    templateUrl: "./table-data.page.html",
    styleUrl: "./table-data.page.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, ContextMenuComponent, TooltipDirective],
    host: {
        "[class.edit-mode]": "!dbService.readOnly()",
        "(keydown)": "onKeydown($event)",
        // Ctrl+N (raccourci global géré par AppComponent).
        "(document:open-new-record)": "newRecord()",
        "tabindex": "0",
    },
})
export class TableDataPage {
    protected readonly dbService = inject(DatabaseService);
    protected readonly state = inject(StateService);
    protected readonly isNoSql = computed(() => this.state.isNoSqlDatabase());
    protected readonly i18n = inject(I18nService);
    private readonly settings = inject(SettingsService);
    private readonly injector = inject(Injector);
    private readonly destroyRef = inject(DestroyRef);
    private readonly modalCtrl = inject(ModalController);
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly document = inject(DOCUMENT);

    protected readonly filterInput = signal<string>("");
    private filterTimeout: ReturnType<typeof setTimeout> | null = null;

    protected readonly editingCell = signal<{ rowid: number; column: string } | null>(null);
    protected readonly editValue = signal<string>("");

    protected readonly columnWidths = signal<Map<string, number>>(new Map());

    /** Ligne sous le curseur clavier (flèches, Entrée). */
    protected readonly cursorRowId = signal<number | null>(null);

    /** Ligne de départ d'une sélection par plage (Maj+clic). */
    private selectionAnchor: number | null = null;

    /**
     * Affichage en date choisi colonne par colonne. Une colonne absente suit le
     * réglage `timestampsAsDates`.
     */
    private readonly timestampOverrides = signal<ReadonlyMap<string, boolean>>(new Map());

    private readonly scrollContainer = viewChild<ElementRef<HTMLDivElement>>("scrollContainer");
    private readonly contextMenu = viewChild(ContextMenuComponent);

    protected readonly fields = computed<FieldDef[]>(() => {
        return this.dbService.tableSchema()?.fields ?? [];
    });

    protected readonly records = computed(() => this.dbService.tableData());
    protected readonly totalCount = computed(() => this.dbService.totalCount());

    /** Hauteur des lignes, selon la densité réglée. */
    protected readonly rowHeight = this.settings.rowHeight;

    /**
     * Seules les lignes visibles sont rendues : une table de plusieurs milliers
     * de lignes chargées garde un DOM de quelques dizaines de lignes.
     */
    protected readonly virtual = new VirtualRows(computed(() => this.records().length), this.settings.rowHeight());

    /** Colonnes prêtes pour l'affichage (police, badge FK, affichage en date). */
    protected readonly columns = computed<GridColumn[]>(() => {
        const samples = this.records().slice(0, TIMESTAMP_SAMPLE_SIZE);
        const overrides = this.timestampOverrides();
        const datesByDefault = this.settings.settings().timestampsAsDates;

        return this.fields().map(field => {
            const timestampCandidate = isTimestampCandidate(field, samples.map(record => record[field.name]));

            return {
                field,
                mono: !isTextType(field.type),
                timestampCandidate,
                showAsDate: timestampCandidate && (overrides.get(field.name) ?? datesByDefault),
                fkTitle: field.fk ? `→ ${field.fk.table}.${field.fk.column}` : "",
            };
        });
    });

    /** `grid-template-columns` partagé par l'en-tête et toutes les lignes. */
    protected readonly gridCols = computed(() => gridTemplateColumns(this.fields(), this.columnWidths()));

    /** Largeur minimale de la grille, au-delà de laquelle elle défile horizontalement. */
    protected readonly gridMinWidth = computed(() => gridMinWidth(this.fields(), this.columnWidths()));

    /** Lignes insérées ou modifiées depuis le début de l'historique (marque de gauche). */
    protected readonly rowMarks = computed<Map<number, RowMark>>(() => {
        const table = this.tableName();
        return table ? rowMarksFromHistory(this.dbService.mutationHistory.history(), table) : new Map();
    });

    /** Préfixe du champ de recherche : loupe en mode texte, `WHERE` en mode requête. */
    protected readonly searchPrefix = computed(() => {
        if (!this.sqlFilterMode()) {
            return "⌕";
        }
        return this.isNoSql() ? "{ }" : "WHERE";
    });

    protected readonly visibleRecords = computed(() => {
        const { start, end } = this.virtual.range();
        return this.records().slice(start, end);
    });

    /**
     * Fonction de tracking pour le @for des lignes.
     * Utilise le rowid si disponible et non-vide, sinon l'index comme fallback.
     * Evite les doublons de clé Angular (NG0955) quand le rowid n'est pas défini.
     */
    protected trackRecord(index: number, record: DbRecord): unknown {
        const rowid = record["rowid"];
        const track = (rowid !== undefined && rowid !== null && rowid !== "") ? rowid : index;
        return track;
    }

    protected readonly selectedRowIds = computed(() => this.dbService.selectedRowIds());
    protected readonly loading = computed(() => this.dbService.loading());
    protected readonly orderBy = computed(() => this.dbService.orderBy());
    protected readonly orderDir = computed(() => this.dbService.orderDir());
    protected readonly tableName = computed(() => this.dbService.selectedTable());
    protected readonly allRowsSelected = computed(() => this.dbService.allRowsSelected());
    protected readonly sqlFilterMode = computed(() => this.dbService.sqlFilterMode());

    /** Placeholder de la barre de filtre SQL adapté au driver actif. */
    protected readonly filterSqlPlaceholder = computed(() => {
        const type = this.state.driverType();
        const isNoSql = this.state.isNoSqlDatabase();
        if (isNoSql) {
            return this.i18n.t("table.filterPlaceholder.nosql");
        }
        if (type === "postgresql") {
            return this.i18n.t("table.filterPlaceholder.postgresql");
        }
        return this.i18n.t("table.filterPlaceholder");
    });

    public constructor() {
        // Les lignes sont mesurées une fois rendues : la hauteur réelle prime
        // sur l'estimation, qui dépend du thème et de la police.
        afterRenderEffect(() => {
            this.visibleRecords();
            this.rowHeight();
            this.virtual.measure(this.scrollContainer()?.nativeElement.querySelector<HTMLElement>(".grid-row"));
        });

        // Changement de densité : la nouvelle hauteur vaut dès le calcul suivant,
        // sans attendre qu'une ligne rendue soit mesurée.
        effect(() => {
            const height = this.rowHeight();
            untracked(() => this.virtual.setRowHeight(height));
        });

        // La hauteur visible suit les redimensionnements de la fenêtre.
        afterNextRender(() => {
            const container = this.scrollContainer()?.nativeElement;

            if (!container) {
                return;
            }

            const observer = new ResizeObserver(() => this.virtual.onScroll(container));
            observer.observe(container);
            this.destroyRef.onDestroy(() => observer.disconnect());
        });

        // Un nouveau jeu de lignes (autre table, filtre, tri) repart du haut.
        effect(() => {
            this.tableName();
            this.dbService.filter();
            this.orderBy();
            this.orderDir();
            untracked(() => this.virtual.reset(this.scrollContainer()?.nativeElement));
        });

        // Changement de table : le champ de recherche reprend le filtre de
        // l'onglet (restauré, ou imposé par une navigation par clé étrangère).
        effect(() => {
            this.tableName(); // Lire le signal pour déclencher l'effet
            this.filterInput.set(untracked(() => this.dbService.filter()));
            this.cursorRowId.set(null);
            this.selectionAnchor = null;
            this.timestampOverrides.set(new Map());
            this.cancelPendingFilter();
        });

        // Passage en lecture seule : l'édition en cours est abandonnée, sans
        // enregistrer, et le champ perd le focus pour ne plus recevoir de saisie.
        effect(() => {
            if (this.dbService.readOnly()) {
                untracked(() => this.cancelEdit());
            }
        });
    }

    /**
     * Largeur rendue d'une colonne, point de départ d'un redimensionnement.
     * @param headerCell - Cellule d'en-tête de la colonne.
     */
    private getRenderedColumnWidth(colName: string, headerCell: HTMLElement | null): number {
        return this.columnWidths().get(colName) ?? headerCell?.getBoundingClientRect().width ?? 150;
    }

    /**
     * Libellé du badge de clé primaire : « ID » en NoSQL, « PK » sinon.
     */
    protected primaryKeyLabel(): string {
        return this.isNoSql() ? "ID" : "PK";
    }

    // --- Tri ---

    protected sortBy(column: string): void {
        this.dbService.sortBy(column);
    }

    protected getSortIcon(column: string): string {
        if (this.orderBy() !== column) {
            return "";
        }
        return this.orderDir() === "ASC" ? "▲" : "▼";
    }

    // --- Filtre avec debounce ---

    protected onFilterInput(value: string): void {
        this.filterInput.set(value);

        if (this.filterTimeout) {
            clearTimeout(this.filterTimeout);
        }

        this.filterTimeout = setTimeout(() => {
            this.dbService.applyFilter(value);
        }, 500);
    }

    /**
     * Choisit le mode de recherche (texte ou requête) et réapplique le filtre.
     * @param sql - `true` pour le mode requête (clause WHERE ou filtre NoSQL).
     */
    protected setFilterMode(sql: boolean): void {
        if (this.sqlFilterMode() === sql) {
            return;
        }

        this.dbService.toggleSqlFilterMode();
        const currentFilter = this.filterInput();
        if (currentFilter.trim().length > 0) {
            this.dbService.applyFilter(currentFilter);
        }
    }

    // --- Édition inline ---

    /**
     * Gère le clic sur une cellule : Ctrl+Click pour FK navigation, sinon édition (en mode readwrite).
     */
    protected onCellClick(event: MouseEvent, rowid: number, field: FieldDef, currentValue: unknown): void {
        // FK Ctrl+Click : naviguer vers la table référencée, sans toucher à la sélection
        if (event.ctrlKey && field.fk && currentValue !== null && currentValue !== undefined) {
            event.stopPropagation();
            this.navigateToForeignKey(field.fk.table, field.fk.column, currentValue);
            return;
        }

        // Ctrl / Maj servent à la sélection (voir onRowClick), pas à l'édition.
        if (this.dbService.readOnly() || event.ctrlKey || event.metaKey || event.shiftKey) {
            return;
        }

        this.startEdit(rowid, field.name, currentValue);
    }

    /**
     * Sélectionne la ligne cliquée : seule par défaut, ajoutée ou retirée avec
     * Ctrl, par plage depuis la dernière ligne cliquée avec Maj.
     */
    protected onRowClick(event: MouseEvent, record: DbRecord): void {
        const rowid = record["rowid"] as number;
        this.cursorRowId.set(rowid);

        if (event.shiftKey && this.selectionAnchor !== null) {
            this.selectRange(this.selectionAnchor, rowid, event.ctrlKey || event.metaKey);
            return;
        }

        this.selectionAnchor = rowid;

        if (event.ctrlKey || event.metaKey) {
            this.dbService.toggleRowSelection(rowid);
        }
        else {
            this.selectOnly(rowid);
        }
    }

    /**
     * Maj+clic et Ctrl+clic sélectionnent des lignes : sans ce blocage, le
     * navigateur étendrait aussi la sélection de texte depuis le clic précédent.
     * Le champ d'une cellule en cours d'édition garde son comportement.
     */
    protected onRowMouseDown(event: MouseEvent): void {
        if (!(event.shiftKey || event.ctrlKey || event.metaKey) || (event.target as HTMLElement).closest(".cell-edit")) {
            return;
        }

        event.preventDefault();
        this.document.getSelection()?.removeAllRanges();
    }

    /**
     * Remplace la sélection par une seule ligne.
     */
    private selectOnly(rowid: number): void {
        this.dbService.allRowsSelected.set(false);
        this.dbService.selectedRowIds.set(new Set([rowid]));
    }

    /**
     * Sélectionne les lignes chargées comprises entre deux lignes, incluses.
     * @param additive - Ajoute la plage à la sélection au lieu de la remplacer.
     */
    private selectRange(fromRowid: number, toRowid: number, additive: boolean): void {
        const records = this.records();
        const from = records.findIndex(r => r["rowid"] === fromRowid);
        const to = records.findIndex(r => r["rowid"] === toRowid);

        if (from === -1 || to === -1) {
            this.selectOnly(toRowid);
            return;
        }

        const [start, end] = from <= to ? [from, to] : [to, from];
        const next = new Set(additive ? this.dbService.selectedRowIds() : []);

        for (const record of records.slice(start, end + 1)) {
            next.add(record["rowid"] as number);
        }

        this.dbService.allRowsSelected.set(false);
        this.dbService.selectedRowIds.set(next);
    }

    /**
     * Gère la navigation clavier.
     */
    protected onKeydown(event: KeyboardEvent): void {
        // Ne pas intercepter quand on est en train d'éditer ou dans un input
        const target = event.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
            return;
        }

        const records = this.records();
        if (records.length === 0) {
            return;
        }

        if (event.key === "ArrowDown") {
            event.preventDefault();
            this.moveCursor(1);
        }
        else if (event.key === "ArrowUp") {
            event.preventDefault();
            this.moveCursor(-1);
        }
        else if (event.key === "Enter") {
            event.preventDefault();
            const cursor = this.cursorRowId();
            if (cursor !== null) {
                this.dbService.toggleRowSelection(cursor);
            }
        }
    }

    /**
     * Déplace le curseur de N positions.
     */
    private moveCursor(delta: number): void {
        const records = this.records();
        const cursor = this.cursorRowId();

        let currentIndex = -1;
        if (cursor !== null) {
            currentIndex = records.findIndex(r => (r["rowid"] as number) === cursor);
        }

        let nextIndex = currentIndex + delta;
        if (nextIndex < 0) {
            nextIndex = 0;
        }
        if (nextIndex >= records.length) {
            nextIndex = records.length - 1;
        }

        const nextRecord = records[nextIndex];
        if (nextRecord) {
            const rowid = nextRecord["rowid"] as number;
            this.cursorRowId.set(rowid);
            this.scrollRowIntoView(rowid);
        }
    }

    /**
     * Fait défiler la vue pour rendre une ligne visible.
     */
    private scrollRowIntoView(rowid: number): void {
        const container = this.scrollContainer()?.nativeElement;
        if (!container) {
            return;
        }

        // La ligne peut être hors du DOM (virtualisée) : on défile par index.
        const index = this.records().findIndex(r => r["rowid"] === rowid);
        if (index === -1) {
            return;
        }

        const headerHeight = container.querySelector(".grid-header")?.getBoundingClientRect().height ?? 0;
        this.virtual.scrollToIndex(container, index, headerHeight);
    }

    protected startEdit(rowid: number, column: string, currentValue: unknown): void {
        if (this.dbService.readOnly()) {
            return;
        }

        const current = this.editingCell();
        if (current && current.rowid === rowid && current.column === column) {
            return;
        }

        this.editingCell.set({ rowid, column });
        this.editValue.set(currentValue === null || currentValue === undefined ? "" : String(currentValue));

        // Après le rendu, focus et select-all sur l'input
        afterNextRender(() => {
            const input = this.scrollContainer()?.nativeElement.querySelector<HTMLInputElement>(".cell-edit");
            if (input) {
                input.focus();
                input.select();
            }
        }, { injector: this.injector });
    }

    protected async commitEdit(): Promise<void> {
        const cell = this.editingCell();
        if (!cell) {
            return;
        }

        const newValue = this.editValue();
        this.editingCell.set(null);

        // Le blur du champ peut suivre un passage en lecture seule.
        if (this.dbService.readOnly() || this.isUnchanged(cell.rowid, cell.column, newValue)) {
            return;
        }

        await this.dbService.updateCell(cell.rowid, cell.column, newValue);
    }

    /**
     * Indique si la valeur saisie est celle de la cellule : quitter une cellule
     * sans la modifier ne doit ni écrire en base, ni démarrer de transaction
     * automatique, ni marquer la ligne comme modifiée.
     */
    private isUnchanged(rowid: number, column: string, value: string): boolean {
        const current = this.records().find(r => r["rowid"] === rowid)?.[column];
        const shown = current === null || current === undefined ? "" : String(current);
        return shown === value;
    }

    protected onEditKeydown(event: KeyboardEvent): void {
        if (event.key === "Enter") {
            event.preventDefault();
            this.commitEdit();
        }
        else if (event.key === "Tab") {
            event.preventDefault();
            this.moveToNextCell(event.shiftKey);
        }
        else if (event.key === "Escape") {
            event.preventDefault();
            this.editingCell.set(null);
        }
    }

    /**
     * Abandonne l'édition en cours sans l'enregistrer et retire le focus du
     * champ, rendu au tableau pour garder la navigation clavier.
     */
    private cancelEdit(): void {
        if (!this.editingCell()) {
            return;
        }

        // La cellule est libérée avant le blur : `commitEdit` n'a plus rien à écrire.
        this.editingCell.set(null);
        this.scrollContainer()?.nativeElement.querySelector<HTMLInputElement>(".cell-edit")?.blur();
        this.host.nativeElement.focus({ preventScroll: true });
    }

    /**
     * Passe à la cellule suivante (ou précédente si shift) en mode édition.
     */
    private moveToNextCell(backward: boolean): void {
        const cell = this.editingCell();
        if (!cell) {
            return;
        }

        // Commit la cellule courante d'abord
        const currentValue = this.editValue();
        this.editingCell.set(null);
        if (this.dbService.readOnly()) {
            return;
        }
        if (!this.isUnchanged(cell.rowid, cell.column, currentValue)) {
            void this.dbService.updateCell(cell.rowid, cell.column, currentValue);
        }

        const fieldNames = this.fields().map(f => f.name);
        const records = this.records();
        const colIndex = fieldNames.indexOf(cell.column);
        const rowIndex = records.findIndex(r => r["rowid"] === cell.rowid);

        if (colIndex === -1 || rowIndex === -1) {
            return;
        }

        let nextCol = colIndex + (backward ? -1 : 1);
        let nextRow = rowIndex;

        if (nextCol >= fieldNames.length) {
            nextCol = 0;
            nextRow++;
        }
        else if (nextCol < 0) {
            nextCol = fieldNames.length - 1;
            nextRow--;
        }

        if (nextRow >= 0 && nextRow < records.length) {
            const nextRecord = records[nextRow];
            const nextColumn = fieldNames[nextCol];
            if (nextRecord && nextColumn) {
                this.startEdit(nextRecord["rowid"] as number, nextColumn, nextRecord[nextColumn]);
            }
        }
    }

    protected isEditing(rowid: number, column: string): boolean {
        const cell = this.editingCell();
        return cell !== null && cell.rowid === rowid && cell.column === column;
    }

    // --- Sélection ---

    protected toggleRowSelection(rowid: number): void {
        this.dbService.toggleRowSelection(rowid);
    }

    protected isRowSelected(rowid: number): boolean {
        return this.dbService.isRowSelected(rowid);
    }

    protected toggleSelectAll(): void {
        this.dbService.toggleSelectAll();
    }

    protected isAllSelected(): boolean {
        return this.allRowsSelected() || (this.records().length > 0 && this.selectedRowIds().size === this.records().length);
    }

    /** Vérifie si une ligne est sous le curseur clavier. */
    protected isCursorRow(rowid: number): boolean {
        return this.cursorRowId() === rowid;
    }

    // --- Suppression ---

    protected async deleteSelected(): Promise<void> {
        await this.dbService.deleteSelectedRows();
    }

    // --- Infinite scroll ---

    protected onScroll(event: Event): void {
        this.virtual.onScroll(event.target as HTMLDivElement);

        if (this.virtual.isNearEnd()) {
            void this.dbService.loadNextPage();
        }
    }

    // --- Resize colonnes ---

    protected startColumnResize(event: MouseEvent, colName: string): void {
        event.preventDefault();
        event.stopPropagation();

        const startX = event.clientX;
        // Une colonne flexible n'a pas de largeur mémorisée : on part de sa largeur rendue.
        const headerCell = (event.target as HTMLElement).parentElement;
        const startWidth = this.getRenderedColumnWidth(colName, headerCell);

        const onMouseMove = (e: MouseEvent): void => {
            const delta = e.clientX - startX;
            const newWidth = Math.max(60, startWidth + delta);
            this.columnWidths.update(map => {
                const next = new Map(map);
                next.set(colName, newWidth);
                return next;
            });
        };

        const onMouseUp = (): void => {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    }

    // --- Nouvel enregistrement ---

    /**
     * Ouvre le formulaire de création. En lecture seule, le mode édition est
     * d'abord activé : le bouton « Nouveau » reste ainsi toujours utilisable.
     */
    protected newRecord(): void {
        if (this.dbService.readOnly()) {
            this.dbService.toggleReadOnly();
        }

        void this.openRecordEditor("create");
    }

    // --- Export ---

    protected async exportJson(): Promise<void> {
        await this.dbService.exportData("json", this.selectedRowIds().size > 0);
    }

    protected async exportCsv(): Promise<void> {
        await this.dbService.exportData("csv", this.selectedRowIds().size > 0);
    }

    protected async exportXlsx(): Promise<void> {
        await this.dbService.exportData("xlsx", this.selectedRowIds().size > 0);
    }

    // --- Menu contextuel ---

    /**
     * Ouvre le menu contextuel sur un clic droit sur une ligne.
     */
    protected onRowContextMenu(event: MouseEvent, record: DbRecord): void {
        const rowid = record["rowid"] as number;

        // Clic droit hors de la sélection : la ligne visée devient la sélection.
        if (!this.isRowSelected(rowid)) {
            this.selectOnly(rowid);
            this.selectionAnchor = rowid;
        }
        this.cursorRowId.set(rowid);

        const selCount = this.dbService.selectedCount();
        const hasMultipleSelection = selCount > 1 || this.allRowsSelected();
        const isReadOnly = this.dbService.readOnly();

        const items: ContextMenuItem[] = [];

        if (!isReadOnly) {
            items.push(
                {
                    label: this.i18n.t(this.isNoSql() ? "contextMenu.edit.nosql" : "contextMenu.edit"),
                    icon: "\uE70F",
                    action: () => this.openRecordEditor("edit", record),
                },
                {
                    label: this.i18n.t(this.isNoSql() ? "contextMenu.duplicate.nosql" : "contextMenu.duplicate"),
                    icon: "\uE8C8",
                    action: () => this.openRecordEditor("duplicate", record),
                },
                {
                    label: this.i18n.t(this.isNoSql() ? "contextMenu.new.nosql" : "contextMenu.new"),
                    icon: "\uE710",
                    action: () => this.openRecordEditor("create"),
                },
            );

            if (hasMultipleSelection) {
                items.push({
                    label: "",
                    icon: "",
                    action: () => {},
                    separator: true,
                });
                items.push({
                    label: this.i18n.t("contextMenu.batchEdit"),
                    icon: "\uE70F",
                    action: () => this.openBatchEdit(),
                });
            }
        }

        if (items.length > 0) {
            items.push({
                label: "",
                icon: "",
                action: () => {},
                separator: true,
            });
        }

        items.push(
            {
                label: this.i18n.t("contextMenu.copyJson"),
                icon: "\uE8C8",
                action: () => this.copySelectionAsJson(record),
            },
        );

        if (!isReadOnly) {
            items.push(
                {
                    label: this.i18n.t("contextMenu.importData"),
                    icon: "\uE8E5",
                    action: () => this.openImportData(),
                },
            );
        }

        items.push(
            {
                label: "",
                icon: "",
                action: () => {},
                separator: true,
            },
        );

        if (!isReadOnly) {
            items.push(
                {
                    label: this.i18n.t("contextMenu.schemaEditor"),
                    icon: "\uE70F",
                    action: () => this.openSchemaEditor(),
                },
            );
        }

        items.push(
            {
                label: this.i18n.t("contextMenu.indexViewer"),
                icon: "\uE721",
                action: () => this.openIndexViewer(),
            },
        );

        if (!isReadOnly) {
            items.push(
                {
                    label: "",
                    icon: "",
                    action: () => {},
                    separator: true,
                },
                {
                    label: hasMultipleSelection
                        ? this.i18n.t("contextMenu.deleteSelection")
                        : this.i18n.t(this.isNoSql() ? "contextMenu.delete.nosql" : "contextMenu.delete"),
                    icon: "\uE74D",
                    action: () => hasMultipleSelection
                        ? this.dbService.deleteSelectedRows()
                        : this.dbService.deleteRow(rowid),
                    danger: true,
                },
            );
        }

        this.contextMenu()?.open(event, items);
    }

    // --- Modal d'édition ---

    /**
     * Ouvre le modal d'édition/création/duplication de record.
     */
    protected async openRecordEditor(mode: RecordEditorMode, record?: DbRecord): Promise<void> {
        const modal = await this.modalCtrl.create({
            component: RecordEditorComponent,
            componentProps: {
                mode,
                record: record ?? null,
                fields: this.fields(),
            },
            backdropClose: false,
            showDots: false,
            blurry: false,
        });

        // Injecter le dismiss du modal dans le composant
        const editor = modal.getComponentInstance<RecordEditorComponent>();
        if (editor) {
            editor.dismiss = (data) => modal.dismiss(data as Partial<UIDismissData>);
        }

        modal.didDismiss.subscribe(async result => {
            if (result.role !== "confirm") {
                return;
            }

            // Recharger les données après modification
            await this.dbService.loadTableData(true);

            // Une ligne créée est sélectionnée et amenée à l'écran si elle fait
            // partie des lignes chargées (sinon le tri la place plus loin).
            const insertedRowid = (result.data as { rowid?: unknown } | undefined)?.rowid;
            if (typeof insertedRowid === "number" && this.records().some(r => r["rowid"] === insertedRowid)) {
                this.selectOnly(insertedRowid);
                this.selectionAnchor = insertedRowid;
                this.cursorRowId.set(insertedRowid);
                this.scrollRowIntoView(insertedRowid);
            }
        });
    }

    // --- FK Navigation ---

    /**
     * Navigue vers la table référencée par une clé étrangère.
     */
    private async navigateToForeignKey(tableName: string, columnName: string, value: unknown): Promise<void> {
        // Le filtre généré est une clause WHERE (ou une requête JSON) : il ne
        // trouve rien en recherche texte, d'où le passage forcé en mode requête.
        const expression = foreignKeyFilter(columnName, value, this.state.driverType());

        this.cancelPendingFilter();
        await this.dbService.selectTable(tableName, { expression, sqlMode: true });
        // Clé étrangère vers la même table : le changement de table ne
        // resynchronise pas le champ de recherche.
        this.filterInput.set(expression);
    }

    /**
     * Abandonne une saisie de recherche encore en attente d'application.
     */
    private cancelPendingFilter(): void {
        if (this.filterTimeout) {
            clearTimeout(this.filterTimeout);
            this.filterTimeout = null;
        }
    }

    /**
     * Formate une valeur pour l'affichage : `NULL`, date pour une colonne
     * affichée en date, `BLOB`, JSON pour un objet (document NoSQL imbriqué).
     */
    protected formatValue(value: unknown, column: GridColumn): string {
        if (value === null || value === undefined) {
            return "NULL";
        }

        if (column.showAsDate) {
            const date = formatEpoch(value, this.i18n.locale());
            if (date !== null) {
                return date;
            }
        }

        if (this.isBlobValue(value)) {
            return "BLOB";
        }

        if (typeof value === "object") {
            return JSON.stringify(value);
        }

        return String(value);
    }

    /**
     * Bascule l'affichage en date d'une colonne d'epochs.
     */
    protected toggleTimestampColumn(column: GridColumn): void {
        this.timestampOverrides.update(overrides => {
            const next = new Map(overrides);
            next.set(column.field.name, !column.showAsDate);
            return next;
        });
    }

    /**
     * Marque de gauche d'une ligne (insérée / modifiée pendant la session).
     */
    protected rowMark(record: DbRecord): RowMark | undefined {
        return this.rowMarks().get(record["rowid"] as number);
    }

    /**
     * Copie la sélection (ou la ligne passée) au format JSON dans le presse-papier.
     */
    protected async copySelectionAsJson(fallbackRecord?: DbRecord): Promise<void> {
        const selected = this.dbService.getSelectedRecords();
        let data: DbRecord[];

        if (selected.length > 0) {
            data = selected;
        }
        else if (fallbackRecord) {
            data = [fallbackRecord];
        }
        else {
            return;
        }

        // Retirer le rowid interne des records exportés
        const cleaned = data.map(r => {
            const { rowid: _rowid, ...rest } = r;
            return rest;
        });

        const json = JSON.stringify(cleaned.length === 1 ? cleaned[0] : cleaned, null, 2);
        await navigator.clipboard.writeText(json);
    }

    /**
     * Ouvre le modal d'édition par lot pour modifier un champ sur toutes les lignes sélectionnées.
     */
    protected async openBatchEdit(): Promise<void> {
        const fields = this.fields().filter(f => !f.pk);
        const rowids = Array.from(this.dbService.selectedRowIds());
        if (fields.length === 0 || rowids.length === 0) {
            return;
        }
        const modal = await this.modalCtrl.create({
            component: BatchEditComponent,
            componentProps: { fields, rowCount: rowids.length },
            backdropClose: false,
            showDots: false,
            blurry: false,
        });
        const editor = modal.getComponentInstance<BatchEditComponent>();
        if (editor) {
            // L'éditeur rend { column, value } ou null : le rôle est posé ici,
            // sinon la fermeture arrivait avec le rôle « none » et rien n'était appliqué.
            editor.dismiss = data => modal.dismiss(data ? { role: "confirm", data } : { role: "cancel" });
        }
        modal.didDismiss.subscribe(async result => {
            // Le formulaire a pu rester ouvert pendant un passage en lecture seule.
            if (result.role === "confirm" && result.data && !this.dbService.readOnly()) {
                const { column, value } = result.data as { column: string; value: unknown };
                await this.dbService.batchUpdate(rowids, column, value);
            }
        });
    }

    /**
     * Ouvre le modal d'import de données (CSV/JSON) avec aperçu.
     */
    protected async openImportData(): Promise<void> {
        const table = this.dbService.selectedTable();
        if (!table) {
            return;
        }
        const modal = await this.modalCtrl.create({
            component: ImportDataComponent,
            componentProps: { tableName: table },
            backdropClose: false,
            showDots: false,
            blurry: false,
        });
        const comp = modal.getComponentInstance<ImportDataComponent>();
        if (comp) {
            comp.dismiss = data => modal.dismiss(data as Partial<UIDismissData>);
        }
        modal.didDismiss.subscribe(async result => {
            if (result.data?.["imported"] === true) {
                await this.dbService.loadTableData(true);
            }
        });
    }

    /**
     * Ouvre le modal d'édition de schéma (renommer table/colonnes, ajouter/supprimer colonnes).
     */
    protected async openSchemaEditor(): Promise<void> {
        const table = this.dbService.selectedTable();
        const fields = this.fields();
        if (!table || fields.length === 0) {
            return;
        }
        const modal = await this.modalCtrl.create({
            component: SchemaEditorComponent,
            componentProps: { tableName: table, fields },
            backdropClose: false,
            showDots: false,
            blurry: false,
        });
        const comp = modal.getComponentInstance<SchemaEditorComponent>();
        if (comp) {
            comp.dismiss = async data => {
                if (data?.["changed"] === true) {
                    const actions = comp.getAlterActions();
                    for (const action of actions) {
                        await this.dbService.alterTable(action);
                    }
                }
                modal.dismiss(data as Partial<UIDismissData>);
            };
        }
    }

    /**
     * Ouvre l'onglet de visualisation et gestion des index de la table courante.
     */
    protected async openIndexViewer(): Promise<void> {
        const table = this.dbService.selectedTable();
        if (!table) {
            return;
        }
        await this.dbService.openIndexesTab(table);
    }

    /**
     * Retourne true si la valeur est un BLOB (Buffer sérialisé, Uint8Array, ou ArrayBuffer).
     */
    protected isBlobValue(value: unknown): boolean {
        if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
            return true;
        }
        if (typeof value === "object" && value !== null && "type" in value && (value as any).type === "Buffer") {
            return true;
        }
        return false;
    }

    /**
     * Ouvre le modal de visualisation d'une image BLOB.
     */
    protected async viewBlobImage(data: unknown, fieldName: string): Promise<void> {
        const { BlobViewerComponent } = await import("src/app/shared/components/blob-viewer/blob-viewer.component");

        const modal = await this.modalCtrl.create({
            component: BlobViewerComponent,
            componentProps: {},
            backdropClose: true,
            showDots: false,
            blurry: false,
        });

        const comp = modal.getComponentInstance<InstanceType<typeof BlobViewerComponent>>();
        if (comp) {
            comp.dismiss = e => modal.dismiss(e);
            comp.loadBlob(data, fieldName);
        }
    }

}
