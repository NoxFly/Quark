import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { DatabaseService } from "src/app/core/services/database.service";
import { I18nService } from "src/app/core/services/i18n.service";
import { StateService } from "src/app/core/services/state.service";

@Component({
    selector: "app-statusbar",
    standalone: true,
    templateUrl: "./statusbar.component.html",
    styleUrl: "./statusbar.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        "[class.visible]": "state.connected()",
    },
})
export class StatusbarComponent {
    protected readonly state = inject(StateService);
    protected readonly dbService = inject(DatabaseService);
    protected readonly i18n = inject(I18nService);

    protected readonly recordInfo = computed(() => {
        const loaded = this.dbService.tableData().length;
        const total = this.dbService.totalCount();
        const table = this.dbService.selectedTable();

        if (!table) {
            return "";
        }

        return this.i18n.t("statusbar.rows", { loaded, total });
    });

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
     * Toggle le mode lecture seule / lecture-écriture.
     */
    protected toggleReadOnly(): void {
        this.dbService.toggleReadOnly();
    }
}
