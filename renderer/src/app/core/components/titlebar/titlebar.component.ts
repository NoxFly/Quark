import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { NoxusService } from "src/app/core/services/noxus.service";

@Component({
    selector: "app-titlebar",
    standalone: true,
    templateUrl: "./titlebar.component.html",
    styleUrl: "./titlebar.component.scss",
    imports: [],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TitlebarComponent {
    private readonly noxus = inject(NoxusService);

    protected readonly appName = signal<string>("SQLite Editor");

    protected closeApp(): void {
        this.noxus.ipc.close();
    }

    protected reduceApp(): void {
        this.noxus.ipc.reduce();
    }

    protected toggleFullscreen(): void {
        this.noxus.ipc.toggleFullscreen();
    }
}
