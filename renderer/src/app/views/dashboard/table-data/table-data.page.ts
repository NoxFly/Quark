import { afterNextRender, ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, Injector, signal, viewChild } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { DatabaseService } from "src/app/core/services/database.service";
import { I18nService } from "src/app/core/services/i18n.service";
import { StateService } from "src/app/core/services/state.service";
import { BatchEditComponent } from "src/app/shared/components/batch-edit/batch-edit.component";
import { ContextMenuComponent } from "src/app/shared/components/context-menu/context-menu.component";
import type { ContextMenuItem } from "src/app/shared/components/context-menu/context-menu.component";
import { ImportDataComponent } from "src/app/shared/components/import-data/import-data.component";
import { IndexViewerComponent } from "src/app/shared/components/index-viewer/index-viewer.component";
import { RecordEditorComponent } from "src/app/shared/components/record-editor/record-editor.component";
import type { RecordEditorMode } from "src/app/shared/components/record-editor/record-editor.component";
import { SchemaEditorComponent } from "src/app/shared/components/schema-editor/schema-editor.component";
import { TransactionDiffComponent } from "src/app/shared/components/transaction-diff/transaction-diff.component";
import { ModalController } from "src/app/shared/ui/components/modal/modal.controller";
import type { UIDismissData } from "src/app/shared/ui/ui.types";
import type { DbRecord, FieldDef } from "@shared/types";
import { ButtonComponent } from "@ui/button/button.component";
import { TooltipDirective } from "src/app/shared/ui/components/tooltip/tooltip.directive";

/**
 * Page d'affichage des données d'une table avec :
 * - Colonnes resizable
 * - Édition inline des cellules (clic simple)
 * - Tri par colonne
 * - Sélection multiple de lignes
 * - Infinite scroll
 * - Mode transaction
 * - Barre de filtre
 */
@Component({
    selector: "app-table-data",
    standalone: true,
    templateUrl: "./table-data.page.html",
    styleUrl: "./table-data.page.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, ContextMenuComponent, ButtonComponent, TooltipDirective],
    host: {
        "[class.transaction-mode]": "dbService.inTransaction()",
        "(keydown)": "onKeydown($event)",
        "tabindex": "0",
    },
})
export class TableDataPage {
    protected readonly dbService = inject(DatabaseService);
    protected readonly state = inject(StateService);
    protected readonly i18n = inject(I18nService);
    private readonly injector = inject(Injector);
    private readonly modalCtrl = inject(ModalController);

    protected readonly filterInput = signal<string>("");
    private filterTimeout: ReturnType<typeof setTimeout> | null = null;

    protected readonly editingCell = signal<{ rowid: number; column: string } | null>(null);
    protected readonly editValue = signal<string>("");

    protected readonly columnWidths = signal<Map<string, number>>(new Map());

    /** Ligne survolée par le curseur clavier en mode readonly. */
    protected readonly cursorRowId = signal<number | null>(null);

    /** Colonnes dont le timestamp est affiché en date formatée. */
    protected readonly timestampColumns = signal<Set<string>>(new Set());

    private readonly scrollContainer = viewChild<ElementRef<HTMLDivElement>>("scrollContainer");
    private readonly contextMenu = viewChild(ContextMenuComponent);

    protected readonly fields = computed<FieldDef[]>(() => {
        return this.dbService.tableSchema()?.fields ?? [];
    });

    protected readonly records = computed(() => this.dbService.tableData());
    protected readonly totalCount = computed(() => this.dbService.totalCount());
    protected readonly selectedRowIds = computed(() => this.dbService.selectedRowIds());
    protected readonly loading = computed(() => this.dbService.loading());
    protected readonly orderBy = computed(() => this.dbService.orderBy());
    protected readonly orderDir = computed(() => this.dbService.orderDir());
    protected readonly inTransaction = computed(() => this.dbService.inTransaction());
    protected readonly tableName = computed(() => this.dbService.selectedTable());
    protected readonly allRowsSelected = computed(() => this.dbService.allRowsSelected());
    protected readonly sqliteFilterMode = computed(() => this.dbService.sqliteFilterMode());

    constructor() {
        // Réinitialiser le filtre lors du changement de table
        effect(() => {
            this.tableName(); // Lire le signal pour déclencher l'effet
            this.filterInput.set("");
            this.cursorRowId.set(null);
            this.timestampColumns.set(new Set());
            if (this.filterTimeout) {
                clearTimeout(this.filterTimeout);
                this.filterTimeout = null;
            }
        });
    }

    /**
     * Retourne la largeur d'une colonne, ou 150px par défaut.
     */
    protected getColumnWidth(colName: string): number {
        return this.columnWidths().get(colName) ?? 150;
    }

    /**
     * Retourne le badge PK/FK pour un champ.
     */
    protected getFieldBadge(field: FieldDef): string {
        if (field.pk) {
            return "PK";
        }
        if (field.fk) {
            return `FK → ${field.fk.table}`;
        }
        return "";
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
     * Toggle le mode de filtre SQLite / full-text et réapplique le filtre.
     */
    protected toggleSqliteFilterMode(): void {
        this.dbService.toggleSqliteFilterMode();
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
        // FK Ctrl+Click : naviguer vers la table référencée
        if (event.ctrlKey && field.fk && currentValue !== null && currentValue !== undefined) {
            this.navigateToForeignKey(field.fk.table, field.fk.column, currentValue);
            return;
        }

        // En mode readonly, le clic est géré par onRowClick
        if (this.dbService.readOnly()) {
            return;
        }

        this.startEdit(rowid, field.name, currentValue);
    }

    /**
     * Gère le clic sur une ligne en mode readonly : positionne le curseur.
     */
    protected onRowClick(event: MouseEvent, record: DbRecord): void {
        const rowid = record["rowid"] as number;
        this.cursorRowId.set(rowid);
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

        const row = container.querySelector(`tr[data-rowid="${rowid}"]`);
        if (row) {
            row.scrollIntoView({ block: "nearest" });
        }
    }

    protected startEdit(rowid: number, column: string, currentValue: unknown): void {
        const current = this.editingCell();
        if (current && current.rowid === rowid && current.column === column) {
            return;
        }

        this.editingCell.set({ rowid, column });
        this.editValue.set(currentValue === null || currentValue === undefined ? "" : String(currentValue));

        // Après le rendu, focus et select-all sur l'input
        afterNextRender(() => {
            const input = document.querySelector<HTMLInputElement>(".cell-edit");
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

        await this.dbService.updateCell(cell.rowid, cell.column, newValue);
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
        this.dbService.updateCell(cell.rowid, cell.column, currentValue);

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
        const el = event.target as HTMLDivElement;
        const threshold = 100;

        if (el.scrollHeight - el.scrollTop - el.clientHeight < threshold) {
            this.dbService.loadNextPage();
        }
    }

    // --- Resize colonnes ---

    protected startColumnResize(event: MouseEvent, colName: string): void {
        event.preventDefault();
        event.stopPropagation();

        const startX = event.clientX;
        const startWidth = this.getColumnWidth(colName);

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

    // --- Transaction ---

    protected async beginTransaction(): Promise<void> {
        await this.dbService.transactionAction("begin");
    }

    protected async commitTransaction(): Promise<void> {
        await this.dbService.transactionAction("commit");
    }

    protected async rollbackTransaction(): Promise<void> {
        await this.dbService.transactionAction("rollback");
    }

    // --- Export ---

    protected async exportJson(): Promise<void> {
        await this.dbService.exportData("json", this.selectedRowIds().size > 0);
    }

    protected async exportCsv(): Promise<void> {
        await this.dbService.exportData("csv", this.selectedRowIds().size > 0);
    }

    // --- Menu contextuel ---

    /**
     * Ouvre le menu contextuel sur un clic droit sur une ligne.
     */
    protected onRowContextMenu(event: MouseEvent, record: DbRecord): void {
        const rowid = record["rowid"] as number;
        const selCount = this.dbService.selectedCount();
        const hasMultipleSelection = selCount > 1 || this.allRowsSelected();

        const items: ContextMenuItem[] = [
            {
                label: this.i18n.t("contextMenu.edit"),
                icon: "\uE70F",
                action: () => this.openRecordEditor("edit", record),
            },
            {
                label: this.i18n.t("contextMenu.duplicate"),
                icon: "\uE8C8",
                action: () => this.openRecordEditor("duplicate", record),
            },
            {
                label: this.i18n.t("contextMenu.new"),
                icon: "\uE710",
                action: () => this.openRecordEditor("create"),
            },
        ];

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

        items.push(
            {
                label: "",
                icon: "",
                action: () => {},
                separator: true,
            },
            {
                label: this.i18n.t("contextMenu.copyJson"),
                icon: "\uE8C8",
                action: () => this.copySelectionAsJson(record),
            },
            {
                label: this.i18n.t("contextMenu.importData"),
                icon: "\uE8E5",
                action: () => this.openImportData(),
            },
            {
                label: "",
                icon: "",
                action: () => {},
                separator: true,
            },
            {
                label: this.i18n.t("contextMenu.schemaEditor"),
                icon: "\uE70F",
                action: () => this.openSchemaEditor(),
            },
            {
                label: this.i18n.t("contextMenu.indexViewer"),
                icon: "\uE721",
                action: () => this.openIndexViewer(),
            },
            {
                label: "",
                icon: "",
                action: () => {},
                separator: true,
            },
            {
                label: hasMultipleSelection
                    ? this.i18n.t("contextMenu.deleteSelection")
                    : this.i18n.t("contextMenu.delete"),
                icon: "\uE74D",
                action: () => hasMultipleSelection
                    ? this.dbService.deleteSelectedRows()
                    : this.dbService.deleteRow(rowid),
                danger: true,
            },
        );

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

        modal.didDismiss.subscribe(result => {
            if (result.role === "confirm") {
                // Recharger les données après modification
                this.dbService.loadTableData(true);
            }
        });
    }

    // --- FK Navigation ---

    /**
     * Navigue vers la table référencée par une clé étrangère.
     */
    private async navigateToForeignKey(tableName: string, columnName: string, value: unknown): Promise<void> {
        await this.dbService.selectTable(tableName);
        const filterExpr = `${columnName} = ${typeof value === "string" ? `'${value}'` : value}`;
        this.filterInput.set(filterExpr);
        this.dbService.applyFilter(filterExpr);
    }

    /**
     * Formate une valeur pour l'affichage.
     * Si la colonne est marquée comme timestamp et la valeur est un nombre plausible, affiche la date formatée.
     */
    protected formatValue(value: unknown, field?: FieldDef): string {
        if (value === null || value === undefined) {
            return "NULL";
        }

        if (field && this.timestampColumns().has(field.name)) {
            const ts = Number(value);
            if (!Number.isNaN(ts) && this.isPlausibleTimestamp(ts)) {
                return this.formatTimestamp(ts);
            }
        }

        return String(value);
    }

    /**
     * Vérifie si une valeur numérique est un timestamp plausible.
     * Supporte les timestamps en secondes et en millisecondes.
     */
    private isPlausibleTimestamp(value: number): boolean {
        // Timestamp en secondes : entre 1970 et 2100
        if (value >= 0 && value <= 4_102_444_800) {
            return true;
        }
        // Timestamp en millisecondes
        if (value >= 0 && value <= 4_102_444_800_000) {
            return true;
        }
        return false;
    }

    /**
     * Formate un timestamp en date lisible (dd/MM/yyyy HH:mm:ss).
     */
    private formatTimestamp(ts: number): string {
        // Convertir en millisecondes si nécessaire
        const ms = ts > 4_102_444_800 ? ts : ts * 1000;
        const date = new Date(ms);
        const locale = this.i18n.locale();
        return new Intl.DateTimeFormat(locale, {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
        }).format(date);
    }

    /**
     * Toggle l'affichage timestamp/date pour une colonne.
     */
    protected toggleTimestampColumn(fieldName: string): void {
        this.timestampColumns.update(set => {
            const next = new Set(set);
            if (next.has(fieldName)) {
                next.delete(fieldName);
            }
            else {
                next.add(fieldName);
            }
            return next;
        });
    }

    /**
     * Vérifie si une colonne est en mode timestamp affiché.
     */
    protected isTimestampColumn(fieldName: string): boolean {
        return this.timestampColumns().has(fieldName);
    }

    /**
     * Vérifie si un champ pourrait contenir des timestamps.
     * Heuristique basée sur le type et le nom de la colonne.
     */
    protected couldBeTimestamp(field: FieldDef): boolean {
        const type = field.type.toLowerCase();
        const name = field.name.toLowerCase();
        const timestampTypes = ["timestamp", "datetime"];
        const timestampNames = ["timestamp", "created", "updated", "date", "time", "at", "_at", "_date"];

        if (timestampTypes.some(t => type.includes(t))) {
            if (timestampNames.some(n => name.includes(n))) {
                return true;
            }
            // Aussi afficher le bouton si le premier record chargé a une valeur plausible
            const firstRecord = this.records()[0];
            if (firstRecord) {
                const val = Number(firstRecord[field.name]);
                if (!Number.isNaN(val) && this.isPlausibleTimestamp(val)) {
                    return true;
                }
            }
        }
        return false;
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
            const { rowid, ...rest } = r;
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
            editor.dismiss = data => modal.dismiss(data as Partial<UIDismissData>);
        }
        modal.didDismiss.subscribe(async result => {
            if (result.role === "confirm" && result.data) {
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
     * Ouvre le modal de visualisation et gestion des index de la table courante.
     */
    protected async openIndexViewer(): Promise<void> {
        const table = this.dbService.selectedTable();
        const fields = this.fields();
        if (!table) {
            return;
        }
        const modal = await this.modalCtrl.create({
            component: IndexViewerComponent,
            componentProps: { tableName: table, fields },
            backdropClose: true,
            showDots: false,
            blurry: false,
        });
        const comp = modal.getComponentInstance<IndexViewerComponent>();
        if (comp) {
            comp.dismiss = data => modal.dismiss(data as Partial<UIDismissData>);
        }
    }

    /**
     * Ouvre le modal de diff montrant les mutations en attente dans la transaction courante.
     */
    protected async openTransactionDiff(): Promise<void> {
        const modal = await this.modalCtrl.create({
            component: TransactionDiffComponent,
            componentProps: {},
            backdropClose: true,
            showDots: false,
            blurry: false,
        });
        const comp = modal.getComponentInstance<TransactionDiffComponent>();
        if (comp) {
            comp.dismiss = () => modal.dismiss();
        }
    }

}
