import { ChangeDetectionStrategy, Component, OnInit } from "@angular/core";

@Component({
    selector: "app-sidebar",
    standalone: true,
    templateUrl: "./sidebar.component.html",
    styleUrl: "./sidebar.component.scss",
    imports: [],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarComponent implements OnInit {
    /**
     *
     */
    public ngOnInit(): void {

    }
}
