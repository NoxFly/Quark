import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { DatabaseService } from "src/app/core/services/database.service";
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

    protected readonly recordInfo = computed(() => {
        const loaded = this.dbService.tableData().length;
        const total = this.dbService.totalCount();
        const table = this.dbService.selectedTable();

        if (!table) {
            return "";
        }

        return `${loaded} / ${total} lignes`;
    });

    protected readonly tableName = computed(() => this.dbService.selectedTable());

    protected readonly selectionInfo = computed(() => {
        const count = this.dbService.selectedRowIds().size;
        if (count === 0) {
            return "";
        }
        return `${count} sélectionnée${count > 1 ? "s" : ""}`;
    });

    protected readonly transactionInfo = computed(() => {
        return this.dbService.inTransaction() ? "Transaction active" : "";
    });
}
