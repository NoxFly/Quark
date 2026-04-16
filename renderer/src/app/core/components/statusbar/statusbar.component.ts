import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { Router } from "@angular/router";
import { TooltipDirective } from "src/app/shared/ui/components/tooltip/tooltip.directive";
import { DatabaseService } from "src/app/core/services/database.service";
import { I18nService } from "src/app/core/services/i18n.service";
import { StateService } from "src/app/core/services/state.service";
import { TabsService, SQL_EDITOR_TAB_ID } from "src/app/core/services/tabs.service";

@Component({
    selector: "app-statusbar",
    standalone: true,
    templateUrl: "./statusbar.component.html",
    styleUrl: "./statusbar.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [TooltipDirective],
    host: {
        "[class.visible]": "state.connected()",
    },
})
export class StatusbarComponent {
    protected readonly state = inject(StateService);
    protected readonly dbService = inject(DatabaseService);
    protected readonly i18n = inject(I18nService);
    private readonly router = inject(Router);
    private readonly tabsService = inject(TabsService);

    protected readonly recordInfo = computed(() => {
        const loaded = this.dbService.tableData().length;
        const total = this.dbService.totalCount();
        const table = this.dbService.selectedTable();

        if (!table) {
            return "";
        }

        return this.i18n.t(
            this.state.isNoSqlDatabase() ? "statusbar.documents" : "statusbar.rows",
            { loaded, total },
        );
    });

    protected readonly tableSizeInfo = computed(() => {
        const size = this.dbService.tableSize();
        if (!size || !this.dbService.selectedTable()) {
            return "";
        }
        return this.formatSize(size);
    });

    /**
     * Formate une taille en octets en une représentation lisible.
     */
    private formatSize(bytes: number): string {
        if (bytes === 0) {
            return "";
        }
        if (bytes < 1024) {
            return `${bytes} B`;
        }
        if (bytes < 1024 * 1024) {
            return `${(bytes / 1024).toFixed(1)} KB`;
        }
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }

    protected readonly tableName = computed(() => this.dbService.selectedTable());

    protected readonly selectionInfo = computed(() => {
        const count = this.dbService.selectedCount();
        if (count === 0) {
            return "";
        }
        return this.i18n.t("statusbar.selected", { count });
    });

    protected readonly transactionInfo = computed(() => {
        return this.dbService.inTransaction() ? this.i18n.t("statusbar.transaction") : "";
    });

    protected readonly readOnly = computed(() => this.dbService.readOnly());

    protected readonly editModeLabel = computed(() => {
        return this.dbService.readOnly()
            ? this.i18n.t("statusbar.readOnly")
            : this.i18n.t("statusbar.readWrite");
    });

    /**
     * Indique si l'utilisateur est actuellement dans l'éditeur SQL.
     */
    protected readonly isInSqlEditor = computed(() => this.router.url.includes("/sql-editor"));

    /**
     * Bascule entre l'éditeur SQL (onglet dédié) et la vue précédente.
     */
    protected toggleSqlEditor(): void {
        if (this.isInSqlEditor()) {
            // Fermer l'onglet SQL editor
            const sqlIdx = this.tabsService.findTab(SQL_EDITOR_TAB_ID);
            if (sqlIdx >= 0) {
                const nextTable = this.tabsService.closeTab(sqlIdx);
                if (nextTable && nextTable !== SQL_EDITOR_TAB_ID) {
                    void this.dbService.selectTable(nextTable);
                }
                else {
                    void this.router.navigate(["/dashboard/no-table"]);
                }
            }
            else {
                void this.router.navigate(["/dashboard/no-table"]);
            }
        }
        else {
            // Ouvrir un onglet SQL editor
            this.tabsService.openTab(SQL_EDITOR_TAB_ID);
            this.dbService.selectedTable.set(null);
            void this.router.navigate(["/dashboard/sql-editor"]);
        }
    }

    /**
     * Toggle le mode lecture seule / lecture-écriture.
     */
    protected toggleReadOnly(): void {
        this.dbService.toggleReadOnly();
    }
}
