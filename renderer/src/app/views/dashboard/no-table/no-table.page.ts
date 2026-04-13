import { ChangeDetectionStrategy, Component } from "@angular/core";

@Component({
    selector: "app-no-table",
    standalone: true,
    templateUrl: "./no-table.page.html",
    styleUrl: "./no-table.page.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
})
export class NoTablePage {}
