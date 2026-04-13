import { ChangeDetectionStrategy, Component } from "@angular/core";

@Component({
    selector: "app-not-desktop",
    standalone: true,
    templateUrl: "./not-desktop.page.html",
    styleUrl: "./not-desktop.page.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
})
export class NotDesktopPage {}
