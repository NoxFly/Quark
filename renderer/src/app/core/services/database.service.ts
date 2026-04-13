import { inject, Injectable, signal } from "@angular/core";
import { Router } from "@angular/router";
import type {
    DatabaseSchema,
    DbRecord,
    R_ExportResponse,
    R_TransactionAction,
    TableSchema,
} from "@shared/types";
import { NoxusService } from "src/app/core/services/noxus.service";
import { StateService } from "src/app/core/services/state.service";

/**
 * Service gérant toute la logique d'interaction avec la base de données
 * via le main process.
 */
@Injectable({ providedIn: "root" })
export class DatabaseService {
    private readonly noxus = inject(NoxusService);
    private readonly state = inject(StateService);
    private readonly router = inject(Router);

    public readonly inTransaction = signal<boolean>(false);
    public readonly selectedTable = signal<string | null>(null);
    public readonly tableData = signal<DbRecord[]>([]);
    public readonly totalCount = signal<number>(0);
    public readonly tableSchema = signal<TableSchema | null>(null);
    public readonly loading = signal<boolean>(false);

    public readonly orderBy = signal<string | null>(null);
    public readonly orderDir = signal<"ASC" | "DESC">("ASC");
    public readonly filter = signal<string>("");

    public readonly selectedRowIds = signal<Set<number>>(new Set());
    public readonly allRowsSelected = signal<boolean>(false);

    /** Mode lecture seule (pas d'édition inline). */
    public readonly readOnly = signal<boolean>(true);

    /** Mode de filtre SQLite (WHERE clause) vs recherche full-text. */
    public readonly sqliteFilterMode = signal<boolean>(false);

    private currentOffset = 0;
    private readonly pageSize = 50;

    /**
     * Ouvre le dialogue de sélection de fichier et ouvre le fichier sélectionné.
     */
    public async openFileDialog(): Promise<void> {
        const filePath = await this.noxus.ipc.openFileDialog();
        if (filePath) {
            await this.openFile(filePath);
        }
    }

    /**
     * Ouvre un fichier de base de données.
     */
    public async openFile(filePath: string): Promise<void> {
        try {
            this.loading.set(true);
            const response = await this.noxus.ipc.openFile(filePath);

            if (response.needsPassword) {
                this.state.needsPassword.set(true);
                this.state.pendingFilePath.set(filePath);
                return;
            }

            if (response.database) {
                this.onDatabaseOpened(response.database);
            }
        }
        catch (err) {
            console.error("Failed to open file:", err);
        }
        finally {
            this.loading.set(false);
        }
    }

    /**
     * Soumet un mot de passe pour déchiffrer la base.
     */
    public async submitPassword(password: string): Promise<boolean> {
        try {
            this.loading.set(true);
            const response = await this.noxus.ipc.submitPassword(password);
            this.state.needsPassword.set(false);
            this.state.pendingFilePath.set(null);
            this.onDatabaseOpened(response.database);
            return true;
        }
        catch {
            return false;
        }
        finally {
            this.loading.set(false);
        }
    }

    /**
     * Ferme le fichier en cours.
     */
    public async closeFile(): Promise<void> {
        try {
            await this.noxus.ipc.closeFile();
            this.state.connected.set(false);
            this.state.database.set(null);
            this.state.filePath.set(null);
            this.state.title.set("SQLite Editor");
            this.state.fileName.set("");
            this.selectedTable.set(null);
            this.tableData.set([]);
            this.totalCount.set(0);
            this.tableSchema.set(null);
            this.inTransaction.set(false);
            this.selectedRowIds.set(new Set());
            this.allRowsSelected.set(false);
            this.router.navigate(["/open-database"]);
        }
        catch (err) {
            console.error("Failed to close file:", err);
        }
    }

    /**
     * Rafraîchit la base de données (ferme et réouvre).
     */
    public async refreshDatabase(): Promise<void> {
        try {
            this.loading.set(true);
            const response = await this.noxus.ipc.refreshDatabase();

            if (response.needsPassword) {
                this.state.needsPassword.set(true);
                return;
            }

            if (response.database) {
                this.onDatabaseOpened(response.database);
            }
        }
        catch (err) {
            console.error("Failed to refresh database:", err);
        }
        finally {
            this.loading.set(false);
        }
    }

    /**
     * Sélectionne une table et charge ses données.
     */
    public async selectTable(tableName: string): Promise<void> {
        this.selectedTable.set(tableName);
        this.currentOffset = 0;
        this.orderBy.set(null);
        this.orderDir.set("ASC");
        this.filter.set("");
        this.selectedRowIds.set(new Set());
        this.allRowsSelected.set(false);

        const db = this.state.database();
        if (db) {
            const schema = db.tables.find(t => t.name === tableName) ?? null;
            this.tableSchema.set(schema);
        }

        await this.loadTableData(true);
        this.router.navigate(["/dashboard/table-data"]);
    }

    /**
     * Charge les données de la table sélectionnée.
     */
    public async loadTableData(reset = false): Promise<void> {
        const table = this.selectedTable();
        if (!table) {
            return;
        }

        if (reset) {
            this.currentOffset = 0;
            this.tableData.set([]);
        }

        this.loading.set(true);

        try {
            const response = await this.noxus.ipc.getTableData({
                table,
                offset: this.currentOffset,
                limit: this.pageSize,
                orderBy: this.orderBy() ?? undefined,
                orderDir: this.orderDir(),
                filter: this.filter() || undefined,
                filterMode: this.sqliteFilterMode() ? "sqlite" : "fulltext",
            });

            if (reset) {
                this.tableData.set(response.records);
            }
            else {
                this.tableData.update(existing => [...existing, ...response.records]);
            }

            this.totalCount.set(response.totalCount);
        }
        catch (err) {
            console.error("Failed to load table data:", err);
        }
        finally {
            this.loading.set(false);
        }
    }

    /**
     * Charge la page suivante (infinite scroll).
     */
    public async loadNextPage(): Promise<void> {
        if (this.tableData().length >= this.totalCount()) {
            return;
        }

        this.currentOffset += this.pageSize;
        await this.loadTableData(false);

        // Si toutes les lignes sont sélectionnées virtuellement, ajouter les nouvelles à la sélection
        if (this.allRowsSelected()) {
            const allIds = new Set(this.tableData().map(r => r["rowid"] as number));
            this.selectedRowIds.set(allIds);
        }
    }

    /**
     * Trie la table par une colonne.
     */
    public async sortBy(column: string): Promise<void> {
        if (this.orderBy() === column) {
            this.orderDir.update(d => d === "ASC" ? "DESC" : "ASC");
        }
        else {
            this.orderBy.set(column);
            this.orderDir.set("ASC");
        }

        await this.loadTableData(true);
    }

    /**
     * Applique un filtre.
     */
    public async applyFilter(filterExpr: string): Promise<void> {
        this.filter.set(filterExpr);
        await this.loadTableData(true);
    }

    /**
     * Met à jour une cellule.
     */
    public async updateCell(rowid: number, column: string, value: unknown): Promise<void> {
        const table = this.selectedTable();
        if (!table) {
            return;
        }

        await this.noxus.ipc.updateCell({ table, rowid, column, value });

        // Mettre à jour localement
        this.tableData.update(records =>
            records.map(r => {
                if (r["rowid"] === rowid) {
                    return { ...r, [column]: value };
                }
                return r;
            })
        );
    }

    /**
     * Supprime les lignes sélectionnées.
     */
    public async deleteSelectedRows(): Promise<void> {
        const table = this.selectedTable();
        const rowids = Array.from(this.selectedRowIds());

        if (!table || rowids.length === 0) {
            return;
        }

        await this.noxus.ipc.deleteRows({ table, rowids });

        this.tableData.update(records =>
            records.filter(r => !rowids.includes(r["rowid"] as number))
        );
        this.totalCount.update(c => c - rowids.length);
        this.selectedRowIds.set(new Set());
    }

    /**
     * Supprime une seule ligne par son rowid.
     */
    public async deleteRow(rowid: number): Promise<void> {
        const table = this.selectedTable();
        if (!table) {
            return;
        }

        await this.noxus.ipc.deleteRows({ table, rowids: [rowid] });

        this.tableData.update(records =>
            records.filter(r => (r["rowid"] as number) !== rowid)
        );
        this.totalCount.update(c => c - 1);
        this.selectedRowIds.update(set => {
            const next = new Set(set);
            next.delete(rowid);
            return next;
        });
    }

    /**
     * Insère une nouvelle ligne dans la table courante.
     */
    public async insertRow(values: Record<string, unknown>): Promise<DbRecord | null> {
        const table = this.selectedTable();
        if (!table) {
            return null;
        }

        const response = await this.noxus.ipc.insertRow({ table, values });

        if (response.record) {
            this.tableData.update(records => [...records, response.record]);
            this.totalCount.update(c => c + 1);
        }

        return response.record;
    }

    /**
     * Duplique une ligne existante (récupère ses valeurs puis insère une copie).
     */
    public async duplicateRow(rowid: number): Promise<DbRecord | null> {
        const table = this.selectedTable();
        if (!table) {
            return null;
        }

        const { record } = await this.noxus.ipc.getRow({ table, rowid });
        if (!record) {
            return null;
        }

        // Retirer le rowid de la copie
        const { rowid: _, ...values } = record;

        // Retirer les clés primaires auto-incrémentées
        const schema = this.tableSchema();
        if (schema) {
            for (const field of schema.fields) {
                if (field.pk) {
                    delete (values as Record<string, unknown>)[field.name];
                }
            }
        }

        return this.insertRow(values as Record<string, unknown>);
    }

    /**
     * Récupère une ligne par son rowid.
     */
    public async getRow(rowid: number): Promise<DbRecord | null> {
        const table = this.selectedTable();
        if (!table) {
            return null;
        }

        const { record } = await this.noxus.ipc.getRow({ table, rowid });
        return record;
    }

    /**
     * Gère les actions de transaction.
     */
    public async transactionAction(action: R_TransactionAction): Promise<void> {
        await this.noxus.ipc.transactionAction(action);

        switch (action) {
            case "begin":
                this.inTransaction.set(true);
                break;
            case "commit":
            case "rollback":
                this.inTransaction.set(false);
                if (action === "rollback") {
                    await this.loadTableData(true);
                }
                break;
        }
    }

    /**
     * Exporte les données.
     */
    public async exportData(format: "json" | "csv", selectedOnly = false): Promise<void> {
        const table = this.selectedTable();
        if (!table) {
            return;
        }

        const body: any = { table, format };

        if (selectedOnly && !this.allRowsSelected()) {
            body.rowids = Array.from(this.selectedRowIds());
        }

        if (this.filter()) {
            body.filter = this.filter();
        }

        const response = await this.noxus.ipc.exportData(body);

        // Déclencher le téléchargement
        const blob = new Blob([response.data], { type: format === "json" ? "application/json" : "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = response.filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    /**
     * Toggle le mode lecture seule / lecture-écriture.
     */
    public toggleReadOnly(): void {
        this.readOnly.update(v => !v);
    }

    /**
     * Toggle le mode de filtre SQLite / full-text.
     */
    public toggleSqliteFilterMode(): void {
        this.sqliteFilterMode.update(v => !v);
    }

    /**
     * Toggle la sélection d'une ligne.
     */
    public toggleRowSelection(rowid: number): void {
        // Si toutes les lignes étaient sélectionnées virtuellement, matérialiser la sélection
        if (this.allRowsSelected()) {
            const allIds = new Set(this.tableData().map(r => r["rowid"] as number));
            allIds.delete(rowid);
            this.selectedRowIds.set(allIds);
            this.allRowsSelected.set(false);
            return;
        }

        this.selectedRowIds.update(set => {
            const next = new Set(set);
            if (next.has(rowid)) {
                next.delete(rowid);
            }
            else {
                next.add(rowid);
            }
            return next;
        });
    }

    /**
     * Sélectionne/désélectionne toutes les lignes (virtuellement).
     */
    public toggleSelectAll(): void {
        if (this.allRowsSelected()) {
            this.allRowsSelected.set(false);
            this.selectedRowIds.set(new Set());
        }
        else {
            this.allRowsSelected.set(true);
            // Matérialiser pour les lignes actuellement chargées
            const allIds = new Set(this.tableData().map(r => r["rowid"] as number));
            this.selectedRowIds.set(allIds);
        }
    }

    /**
     * Vérifie si une ligne est sélectionnée.
     */
    public isRowSelected(rowid: number): boolean {
        return this.allRowsSelected() || this.selectedRowIds().has(rowid);
    }

    /**
     * Retourne le nombre de lignes sélectionnées (virtuel ou réel).
     */
    public selectedCount(): number {
        return this.allRowsSelected() ? this.totalCount() : this.selectedRowIds().size;
    }

    /**
     * Restaure l'état du renderer depuis le main process (après un reload).
     */
    public async restoreState(): Promise<void> {
        try {
            const state = await this.noxus.ipc.getWindowState();
            this.inTransaction.set(state.inTransaction);

            if (state.database) {
                this.onDatabaseOpened(state.database);
            }
        }
        catch (err) {
            console.error("Failed to restore window state:", err);
        }
    }

    /**
     * Récupère les données sélectionnées sous forme de tableau de records.
     * Si allRowsSelected, retourne toutes les données chargées.
     */
    public getSelectedRecords(): DbRecord[] {
        const records = this.tableData();

        if (this.allRowsSelected()) {
            return records;
        }

        const selected = this.selectedRowIds();
        if (selected.size === 0) {
            return [];
        }

        return records.filter(r => selected.has(r["rowid"] as number));
    }

    /**
     * Appelé lorsqu'une base de données est ouverte avec succès.
     */
    private onDatabaseOpened(database: DatabaseSchema): void {
        this.state.connected.set(true);
        this.state.database.set(database);
        this.state.filePath.set(database.path);
        this.state.title.set(database.name);
        this.state.fileName.set(database.name);
        this.router.navigate(["/dashboard/no-table"]);
    }
}
