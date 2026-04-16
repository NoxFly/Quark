import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from "@angular/core";
import { Router, RouterOutlet } from "@angular/router";
import { AppState } from "@shared/types";
import { DatabaseService } from "src/app/core/services/database.service";
import { NoxusService } from "src/app/core/services/noxus.service";
import { StateService } from "src/app/core/services/state.service";
import { TabsService, SQL_EDITOR_TAB_ID } from "src/app/core/services/tabs.service";
import { ThemeService } from "src/app/core/services/theme.service";
import { MonacoPreloadService } from "src/app/core/services/monaco-preload.service";
import { SidebarComponent } from "./core/components/sidebar/sidebar.component";
import { StatusbarComponent } from "./core/components/statusbar/statusbar.component";
import { TabsBarComponent } from "./core/components/tabs-bar/tabs-bar.component";
import { TitlebarComponent } from "./core/components/titlebar/titlebar.component";
import { LoadingScreenComponent } from "./shared/components/loading-screen/loading-screen.component";
import { ThemePickerComponent } from "./shared/components/theme-picker/theme-picker.component";
import { RecentDatabasesComponent } from "./shared/components/recent-databases/recent-databases.component";
import { ChangePasswordComponent } from "./shared/components/change-password/change-password.component";
import { CreateTableComponent } from "./shared/components/create-table/create-table.component";
import { IndexViewerComponent } from "./shared/components/index-viewer/index-viewer.component";
import { SchemaEditorComponent } from "./shared/components/schema-editor/schema-editor.component";
import { AlertController } from "@ui/alert/alert.controller";
import { ModalController } from "src/app/shared/ui/components/modal/modal.controller";
import type { UIDismissData } from "src/app/shared/ui/ui.types";


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
        TabsBarComponent,
        ThemePickerComponent,
        RecentDatabasesComponent,
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
    private readonly tabsService = inject(TabsService);
    private readonly themeService = inject(ThemeService);
    private readonly alertCtrl = inject(AlertController);
    private readonly modalCtrl = inject(ModalController);
    private readonly monacoPreload = inject(MonacoPreloadService);
    private readonly destroyRef = inject(DestroyRef);

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
        const onAbout = (): void => this.showAboutDialog();
        const onCreateTable = (): void => { void this.openCreateTable(); };
        const onChangePassword = (): void => { void this.openChangePassword(); };
        const onSchemaEditor = (): void => { void this.openSchemaEditor(); };
        const onIndexViewer = (): void => { void this.openIndexViewer(); };

        document.addEventListener("open-about-dialog", onAbout);
        document.addEventListener("open-create-table", onCreateTable);
        document.addEventListener("open-change-password", onChangePassword);
        document.addEventListener("open-schema-editor", onSchemaEditor);
        document.addEventListener("open-index-viewer", onIndexViewer);

        this.destroyRef.onDestroy(() => {
            document.removeEventListener("open-about-dialog", onAbout);
            document.removeEventListener("open-create-table", onCreateTable);
            document.removeEventListener("open-change-password", onChangePassword);
            document.removeEventListener("open-schema-editor", onSchemaEditor);
            document.removeEventListener("open-index-viewer", onIndexViewer);
        });

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

        // Restaurer l'état de la fenêtre (transaction, etc.) depuis le main process
        const windowState = await this.noxus.ipc.getWindowState();
        this.dbService.inTransaction.set(windowState.inTransaction);

        this.isReady.set(true);

        // Précharger Monaco Editor en arrière-plan pour un affichage instantané
        this.monacoPreload.preload();

        if (this.pendingNavigationRequest) {
            this.router.navigateByUrl(this.pendingNavigationRequest);
            this.pendingNavigationRequest = null;
        }
        else if (appState.connected && appState.database) {
            this.state.connected.set(true);
            this.state.database.set(appState.database);
            this.state.filePath.set(appState.filePath);
            this.state.driverType.set(appState.driverType);
            this.state.driverInfo.set(appState.driverInfo);
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

        // Chord: Ctrl+K, Ctrl+F → fermer le fichier
        if (this.ctrlKPressed && event.ctrlKey && event.key === "f") {
            event.preventDefault();
            this.ctrlKPressed = false;
            if (this.state.connected()) {
                void this.dbService.closeFile();
            }
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

        // Ctrl+R : bases de données récentes
        if (event.ctrlKey && !event.shiftKey && !event.altKey && event.key === "r") {
            event.preventDefault();
            document.dispatchEvent(new CustomEvent("open-recent-databases"));
        }

        // Ctrl+Alt+R : recharger le renderer
        if (event.ctrlKey && event.altKey && event.key === "r") {
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
        if (event.ctrlKey && !event.altKey && event.key === "o") {
            event.preventDefault();
            this.dbService.openFileDialog();
        }

        // Ctrl+W : fermer l'onglet actif (si un onglet est ouvert)
        if (event.ctrlKey && !event.altKey && event.key === "w") {
            event.preventDefault();
            if (this.state.connected() && this.dbService.tabs.activeTabIndex() >= 0) {
                void this.dbService.closeActiveTab();
            }
        }

        // Ctrl+Shift+N : nouvelle fenêtre
        if (event.ctrlKey && !event.altKey && event.shiftKey && event.key === "N") {
            event.preventDefault();
            this.noxus.ipc.newWindow();
        }

        // F11 : plein écran
        if (event.key === "F11") {
            event.preventDefault();
            this.noxus.ipc.toggleFullscreen();
        }

        // Ctrl+E : toggle mode édition
        if (event.ctrlKey && !event.altKey && event.key === "e") {
            event.preventDefault();
            if (this.state.connected()) {
                this.dbService.toggleReadOnly();
            }
        }

        // Ctrl+T : démarrer une transaction (si pas déjà active) / aucune action sinon
        if (event.ctrlKey && !event.shiftKey && !event.altKey && event.key === "t" && !this.ctrlKPressed) {
            event.preventDefault();
            if (this.state.connected() && !this.dbService.inTransaction()) {
                this.dbService.transactionAction("begin");
            }
        }

        // Ctrl+Z : annuler la dernière mutation
        if (event.ctrlKey && !event.shiftKey && !event.altKey && event.key === "z") {
            const target = event.target as HTMLElement;
            if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") {
                event.preventDefault();
                if (this.state.connected() && this.dbService.mutationHistory.canUndo()) {
                    this.dbService.undoLastMutation();
                }
            }
        }

        // Ctrl+Y : rétablir la dernière mutation annulée
        if (event.ctrlKey && !event.shiftKey && !event.altKey && event.key === "y") {
            const target = event.target as HTMLElement;
            if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") {
                event.preventDefault();
                if (this.state.connected() && this.dbService.mutationHistory.canRedo()) {
                    this.dbService.redoLastMutation();
                }
            }
        }

        // Ctrl+Shift+Q : ouvrir l'éditeur SQL
        if (event.ctrlKey && !event.altKey && event.shiftKey && event.key === "Q") {
            event.preventDefault();
            const capabilities = this.state.capabilities();
            if (this.state.connected() && (!capabilities || capabilities.sqlQueries)) {
                this.tabsService.openTab(SQL_EDITOR_TAB_ID);
                this.dbService.selectedTable.set(null);
                this.router.navigate(["/dashboard/sql-editor"]);
            }
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
            if (file) {
                const filePath = this.noxus.ipc.getFilePathFromDrop(file);
                if (filePath) {
                    this.dbService.openFile(filePath);
                }
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

    /**
     * Ouvre le modal de création d'une nouvelle table.
     */
    private async openCreateTable(): Promise<void> {
        const modal = await this.modalCtrl.create({
            component: CreateTableComponent,
            componentProps: {},
            backdropClose: false,
            showDots: false,
            blurry: false,
        });
        const comp = modal.getComponentInstance<CreateTableComponent>();
        if (comp) {
            comp.dismiss = data => modal.dismiss(data as Partial<UIDismissData>);
        }
        modal.didDismiss.subscribe(async result => {
            if (result.role === "confirm") {
                await this.dbService.refreshDatabase();
            }
        });
    }

    /**
     * Ouvre le modal de changement de mot de passe / chiffrement.
     */
    private async openChangePassword(): Promise<void> {
        const modal = await this.modalCtrl.create({
            component: ChangePasswordComponent,
            componentProps: {},
            backdropClose: false,
            showDots: false,
            blurry: false,
        });
        const comp = modal.getComponentInstance<ChangePasswordComponent>();
        if (comp) {
            comp.dismiss = data => modal.dismiss(data as Partial<UIDismissData>);
        }
    }

    /**
     * Ouvre le modal d'édition de schéma de la table active.
     */
    private async openSchemaEditor(): Promise<void> {
        const table = this.dbService.selectedTable();
        const fields = this.dbService.tableSchema()?.fields ?? [];
        if (!table || fields.length === 0) {
            return;
        }
        const modal = await this.modalCtrl.create({
            component: SchemaEditorComponent,
            componentProps: { tableName: table, fields },
            backdropClose: false,
            showDots: false,
            blurry: false,
        });
        const comp = modal.getComponentInstance<SchemaEditorComponent>();
        if (comp) {
            comp.dismiss = async data => {
                if (data?.["changed"] === true) {
                    const actions = comp.getAlterActions();
                    for (const action of actions) {
                        await this.dbService.alterTable(action);
                    }
                }
                modal.dismiss(data as Partial<UIDismissData>);
            };
        }
    }

    /**
     * Ouvre le modal de visualisation des index de la table active.
     */
    private async openIndexViewer(): Promise<void> {
        const table = this.dbService.selectedTable();
        const fields = this.dbService.tableSchema()?.fields ?? [];
        if (!table) {
            return;
        }
        const modal = await this.modalCtrl.create({
            component: IndexViewerComponent,
            componentProps: { tableName: table, fields },
            backdropClose: true,
            showDots: false,
            blurry: false,
        });
        const comp = modal.getComponentInstance<IndexViewerComponent>();
        if (comp) {
            comp.dismiss = data => modal.dismiss(data as Partial<UIDismissData>);
        }
    }
}
