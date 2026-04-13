import { ChangeDetectionStrategy, Component } from "@angular/core";

@Component({
    selector: "app-table-data",
    standalone: true,
    templateUrl: "./table-data.page.html",
    styleUrl: "./table-data.page.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
})
export class TableDataPage {}
