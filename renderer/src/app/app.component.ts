import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { Router, RouterOutlet } from "@angular/router";
import { AppState } from "@shared/types";
import { NoxusService } from "src/app/core/services/noxus.service";
import { StateService } from "src/app/core/services/state.service";
import { SidebarComponent } from "./core/components/sidebar/sidebar.component";
import { TitlebarComponent } from "./core/components/titlebar/titlebar.component";
import { LoadingScreenComponent } from "./shared/components/loading-screen/loading-screen.component";


@Component({
    selector: "app-root",
    standalone: true,
    templateUrl: "./app.component.html",
    styleUrl: "./app.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        RouterOutlet,
        TitlebarComponent,
        LoadingScreenComponent,
        SidebarComponent,
    ],
    host: {
        '(window:beforeunload)': 'handleBeforeUnload()',
        '(window:keydown)': 'handleKeydown($event)',
        '(window:focus)': 'hasFocus.set(true)',
        '(window:blur)': 'hasFocus.set(false)',
        '(mouseenter)': 'isHovered.set(true)',
        '(mouseleave)': 'isHovered.set(false)',
        '[class.app-blurred]': 'hasFocus() === false',
        '[class.hovered]': 'isHovered() === true',
    }
})
export class AppComponent {
    /**
     * Est-ce que l'application est en train de se recharger (et non de se charger pour la première fois).
     */
    protected isReloading = false;

    /**
     * Est-ce que l'application est prête à être utilisée.
     */
    protected readonly isReady = signal<boolean>(false);

    protected readonly hasFocus = signal<boolean>(true);
    protected readonly isHovered = signal<boolean>(true);

    private pendingNavigationRequest: string | null = null;

    private readonly state = inject(StateService);
    private readonly router = inject(Router);
    private readonly noxus = inject(NoxusService);

    /**
     *
     */
    public constructor() {
        if (!this.noxus.isElectronEnvironment()) {
            this.isReady.set(true);
            this.router.navigateByUrl("/not-desktop");
            return;
        }

        this.noxus.ipc.onNavigationRequested((url: string) => {
            if (!this.isReady()) {
                this.pendingNavigationRequest = url;
                return;
            }

            this.router.navigateByUrl(url);
        });

        this.load();
    }

    /**
     *
     * @returns
     */
    private async load(): Promise<void> {
        if (this.isReady()) {
            return;
        }

        await this.noxus.init();

        const state = await this.noxus.request<AppState>({
            method: "GET",
            path: "app/state",
        });

        this.isReady.set(true);

        if (this.pendingNavigationRequest) {
            this.router.navigateByUrl(this.pendingNavigationRequest);
            this.pendingNavigationRequest = null;
        }
        else {
            // if(state.isConnected && state.database) {
            //     this.state.connected.set(true);
            //     this.state.database.set(state.database);
            //     this.router.navigate(["/dashboard"]);
            // }
            // else {
            //     this.router.navigate(["/open-database"]);
            // }
        }
    }

    /**
     *
     */
    protected handleBeforeUnload(): void {
        this.isReloading = true;
        this.isReady.set(false);
    }

    /**
     *
     */
    protected handleKeydown(event: KeyboardEvent): void {
        if (event.ctrlKey && event.key === "r") {
            event.preventDefault();
            this.noxus.ipc.requestReload();
        }
    }
}
