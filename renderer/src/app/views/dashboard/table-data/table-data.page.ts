import { afterNextRender, ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, Injector, signal, viewChild } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { DatabaseService } from "src/app/core/services/database.service";
import { I18nService } from "src/app/core/services/i18n.service";
import { StateService } from "src/app/core/services/state.service";
import { ContextMenuComponent } from "src/app/shared/components/context-menu/context-menu.component";
import type { ContextMenuItem } from "src/app/shared/components/context-menu/context-menu.component";
import { RecordEditorComponent } from "src/app/shared/components/record-editor/record-editor.component";
import type { RecordEditorMode } from "src/app/shared/components/record-editor/record-editor.component";
import { ModalController } from "src/app/shared/ui/components/modal/modal.controller";
import type { UIDismissData } from "src/app/shared/ui/ui.types";
import type { DbRecord, FieldDef } from "@shared/types";
import { ButtonComponent } from "@ui/button/button.component";

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
    imports: [FormsModule, ContextMenuComponent, ButtonComponent],
    host: {
        "[class.transaction-mode]": "dbService.inTransaction()",
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

    constructor() {
        // Réinitialiser le filtre lors du changement de table
        effect(() => {
            this.tableName(); // Lire le signal pour déclencher l'effet
            this.filterInput.set("");
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

    // --- Édition inline ---

    /**
     * Gère le clic sur une cellule : Ctrl+Click pour FK navigation, sinon édition.
     */
    protected onCellClick(event: MouseEvent, rowid: number, field: FieldDef, currentValue: unknown): void {
        // FK Ctrl+Click : naviguer vers la table référencée
        if (event.ctrlKey && field.fk && currentValue !== null && currentValue !== undefined) {
            this.navigateToForeignKey(field.fk.table, field.fk.column, currentValue);
            return;
        }

        this.startEdit(rowid, field.name, currentValue);
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
        return this.selectedRowIds().has(rowid);
    }

    protected toggleSelectAll(): void {
        this.dbService.toggleSelectAll();
    }

    protected isAllSelected(): boolean {
        const records = this.records();
        const selected = this.selectedRowIds();
        return records.length > 0 && selected.size === records.length;
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
            {
                label: "",
                icon: "",
                action: () => {},
                separator: true,
            },
            {
                label: this.i18n.t("contextMenu.delete"),
                icon: "\uE74D",
                action: () => this.dbService.deleteRow(rowid),
                danger: true,
            },
        ];

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
     */
    protected formatValue(value: unknown): string {
        if (value === null || value === undefined) {
            return "NULL";
        }
        return String(value);
    }
}
