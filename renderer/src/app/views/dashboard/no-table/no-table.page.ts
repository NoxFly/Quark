import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { I18nService } from "src/app/core/services/i18n.service";
import { StateService } from "src/app/core/services/state.service";

@Component({
    selector: "app-no-table",
    standalone: true,
    templateUrl: "./no-table.page.html",
    styleUrl: "./no-table.page.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
})
export class NoTablePage {
    protected readonly state = inject(StateService);
    protected readonly i18n = inject(I18nService);

    protected readonly tableCount = computed(() => {
        return this.state.database()?.tables.length ?? 0;
    });
}
