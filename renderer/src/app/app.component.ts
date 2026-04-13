import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { Router, RouterOutlet } from "@angular/router";
import { AppState } from "@shared/types";
import { DatabaseService } from "src/app/core/services/database.service";
import { NoxusService } from "src/app/core/services/noxus.service";
import { StateService } from "src/app/core/services/state.service";
import { ThemeService } from "src/app/core/services/theme.service";
import { SidebarComponent } from "./core/components/sidebar/sidebar.component";
import { StatusbarComponent } from "./core/components/statusbar/statusbar.component";
import { TitlebarComponent } from "./core/components/titlebar/titlebar.component";
import { LoadingScreenComponent } from "./shared/components/loading-screen/loading-screen.component";
import { ThemePickerComponent } from "./shared/components/theme-picker/theme-picker.component";
import { AlertController } from "@ui/alert/alert.controller";


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
        StatusbarComponent,
        ThemePickerComponent,
    ],
    host: {
        "(window:beforeunload)": "handleBeforeUnload()",
        "(window:keydown)": "handleKeydown($event)",
        "(window:focus)": "hasFocus.set(true)",
        "(window:blur)": "hasFocus.set(false)",
        "(mouseenter)": "isHovered.set(true)",
        "(mouseleave)": "isHovered.set(false)",
        "(dragover)": "onGlobalDragOver($event)",
        "(drop)": "onGlobalDrop($event)",
        "[class.app-blurred]": "hasFocus() === false",
        "[class.hovered]": "isHovered() === true",
    },
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

    /** Tracks Ctrl+K prefix for chord shortcuts like Ctrl+K, Ctrl+T */
    private ctrlKPressed = false;

    private readonly state = inject(StateService);
    private readonly router = inject(Router);
    private readonly noxus = inject(NoxusService);
    private readonly dbService = inject(DatabaseService);
    private readonly themeService = inject(ThemeService);
    private readonly alertCtrl = inject(AlertController);

    /**
     *
     */
    public constructor() {
        this.themeService.restoreFromCache();

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

        // Écouter les événements d'ouverture de fichier depuis le main process
        this.noxus.ipc.onFileOpened((filePath: string) => {
            this.dbService.openFile(filePath);
        });

        // Écouter les changements de titre depuis le main process
        this.noxus.ipc.onTitleChanged((title: string) => {
            this.state.fileName.set(title);
        });

        // Écouter l'événement "À propos" depuis le titlebar
        document.addEventListener("open-about-dialog", () => this.showAboutDialog());

        this.load();
    }

    /**
     *
     */
    private async load(): Promise<void> {
        if (this.isReady()) {
            return;
        }

        await this.noxus.init();

        // Charger les infos de l'application
        const loadResult = await this.noxus.ipc.loadApp();
        this.state.appName.set(loadResult.appName);
        this.state.appVersion.set(loadResult.appVersion);

        const appState = await this.noxus.request<AppState>({
            method: "GET",
            path: "app/state",
        });

        this.isReady.set(true);

        if (this.pendingNavigationRequest) {
            this.router.navigateByUrl(this.pendingNavigationRequest);
            this.pendingNavigationRequest = null;
        }
        else if (appState.connected && appState.database) {
            this.state.connected.set(true);
            this.state.database.set(appState.database);
            this.state.filePath.set(appState.filePath);
            this.state.title.set(appState.database.name);
            this.state.fileName.set(appState.database.name);
            this.router.navigate(["/dashboard/no-table"]);
        }
        else {
            this.router.navigate(["/open-database"]);
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
     * Gère les raccourcis clavier globaux.
     */
    protected handleKeydown(event: KeyboardEvent): void {
        // Chord: Ctrl+K, Ctrl+T
        if (this.ctrlKPressed && event.ctrlKey && event.key === "t") {
            event.preventDefault();
            this.ctrlKPressed = false;
            document.dispatchEvent(new CustomEvent("open-theme-picker"));
            return;
        }

        if (event.ctrlKey && event.key === "k") {
            event.preventDefault();
            this.ctrlKPressed = true;
            // Reset après un délai
            setTimeout(() => { this.ctrlKPressed = false; }, 1000);
            return;
        }

        this.ctrlKPressed = false;

        // Ctrl+R : recharger
        if (event.ctrlKey && !event.shiftKey && event.key === "r") {
            event.preventDefault();
            this.noxus.ipc.requestReload();
        }

        // Ctrl+Shift+R : rafraîchir la base
        if (event.ctrlKey && event.shiftKey && event.key === "R") {
            event.preventDefault();
            if (this.state.connected()) {
                this.dbService.refreshDatabase();
            }
        }

        // Ctrl+O : ouvrir un fichier
        if (event.ctrlKey && event.key === "o") {
            event.preventDefault();
            this.dbService.openFileDialog();
        }

        // Ctrl+W : fermer le fichier
        if (event.ctrlKey && event.key === "w") {
            event.preventDefault();
            if (this.state.connected()) {
                this.dbService.closeFile();
            }
        }

        // Ctrl+Shift+N : nouvelle fenêtre
        if (event.ctrlKey && event.shiftKey && event.key === "N") {
            event.preventDefault();
            this.noxus.ipc.newWindow();
        }

        // F11 : plein écran
        if (event.key === "F11") {
            event.preventDefault();
            this.noxus.ipc.toggleFullscreen();
        }
    }

    /**
     * Empêche le comportement par défaut du drag over global.
     */
    protected onGlobalDragOver(event: DragEvent): void {
        event.preventDefault();
    }

    /**
     * Gère le drop global sur la fenêtre.
     */
    protected onGlobalDrop(event: DragEvent): void {
        event.preventDefault();

        const files = event.dataTransfer?.files;
        if (files && files.length > 0) {
            const file = files[0];
            const filePath = (file as any).path as string;
            if (filePath) {
                this.dbService.openFile(filePath);
            }
        }
    }

    /**
     * Affiche la modale "À propos".
     */
    private showAboutDialog(): void {
        this.alertCtrl.create({
            title: this.state.appName(),
            message: `Version ${this.state.appVersion()}`,
            color: "primary",
            actions: [
                {
                    text: "OK",
                    role: "cancel",
                },
            ],
        });
    }
}
