/*
 * Quark
 * Copyright (C) 2026 NoxFly
 *
 * FR : Ce programme est un logiciel libre ; vous pouvez le redistribuer ou le
 * modifier selon les termes de la GNU Affero General Public License, version 3,
 * telle que publiée par la Free Software Foundation. Il est distribué dans
 * l'espoir d'être utile, mais SANS AUCUNE GARANTIE. Voir le fichier LICENSE.
 *
 * EN : This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License, version 3, as
 * published by the Free Software Foundation. It is distributed in the hope that
 * it will be useful, but WITHOUT ANY WARRANTY. See the LICENSE file.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from "@angular/core";
import { Router, RouterOutlet } from "@angular/router";
import { AppState } from "@shared/types";
import { DatabaseService } from "src/app/core/services/database.service";
import { NoxusService } from "src/app/core/services/noxus.service";
import { StateService } from "src/app/core/services/state.service";
import { SESSION_DIFF_TAB_ID, SQL_EDITOR_TAB_ID, TabsService } from "src/app/core/services/tabs.service";
import { ThemeService } from "src/app/core/services/theme.service";
import { MonacoPreloadService } from "src/app/core/services/monaco-preload.service";
import { SidebarComponent } from "./core/components/sidebar/sidebar.component";
import { StatusbarComponent } from "./core/components/statusbar/statusbar.component";
import { TabsBarComponent } from "./core/components/tabs-bar/tabs-bar.component";
import { TitlebarComponent } from "./core/components/titlebar/titlebar.component";
import { LoadingScreenComponent } from "./shared/components/loading-screen/loading-screen.component";
import { ThemePickerComponent } from "./shared/components/theme-picker/theme-picker.component";
import { RecentDatabasesComponent } from "./shared/components/recent-databases/recent-databases.component";
import { PasswordPromptComponent } from "./shared/components/password-prompt/password-prompt.component";
import { StartupErrorComponent } from "./shared/components/startup-error/startup-error.component";
import { ChangePasswordComponent } from "./shared/components/change-password/change-password.component";
import { CreateTableComponent } from "./shared/components/create-table/create-table.component";
import { IndexViewerComponent } from "./shared/components/index-viewer/index-viewer.component";
import { SchemaEditorComponent } from "./shared/components/schema-editor/schema-editor.component";
import { EntitySearchComponent } from "./shared/components/entity-search/entity-search.component";
import { AlertController } from "@ui/alert/alert.controller";
import { ModalController } from "src/app/shared/ui/components/modal/modal.controller";
import { StoredProceduresService } from "src/app/core/services/stored-procedures.service";
import { SessionDiffService } from "src/app/core/services/session-diff.service";
import { UpdateService } from "src/app/core/services/update.service";
import { withTimeout } from "src/app/shared/helpers/global.helper";
import type { UIDismissData } from "src/app/shared/ui/ui.types";

/**
 * Échéance de la poignée de main du pont IPC. Plus large que les autres étapes :
 * elle inclut le démarrage du process main sur une machine froide.
 */
const BRIDGE_TIMEOUT_MS = 20_000;

/** Échéance de chaque requête d'initialisation qui suit la poignée de main. */
const STARTUP_STEP_TIMEOUT_MS = 15_000;


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
        PasswordPromptComponent,
        EntitySearchComponent,
        StartupErrorComponent,
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

    /**
     * Message d'échec de l'initialisation, `null` tant que rien n'a échoué.
     * Sa présence remplace l'écran de chargement par un écran d'erreur actionnable.
     */
    protected readonly startupError = signal<string | null>(null);

    private pendingNavigationRequest: string | null = null;

    /** Tracks Ctrl+K prefix for chord shortcuts like Ctrl+K, Ctrl+T */
    private ctrlKPressed = false;

    protected readonly state = inject(StateService);
    private readonly router = inject(Router);
    private readonly noxus = inject(NoxusService);
    private readonly dbService = inject(DatabaseService);
    private readonly tabsService = inject(TabsService);
    private readonly themeService = inject(ThemeService);
    private readonly alertCtrl = inject(AlertController);
    private readonly modalCtrl = inject(ModalController);
    private readonly monacoPreload = inject(MonacoPreloadService);
    private readonly storedProcService = inject(StoredProceduresService);
    private readonly updateService = inject(UpdateService);
    private readonly sessionDiffService = inject(SessionDiffService);
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

        // Le main recherche les mises à jour de lui-même ; on se contente d'écouter
        // pour proposer l'installation le moment venu.
        this.updateService.listen();

        // Le journal des modifications de session vit dans le main : on suit ses
        // compteurs en continu, le contenu n'est chargé que par la page dédiée.
        this.sessionDiffService.listen();

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

        void this.load();
    }

    /**
     * Initialise l'application : poignée de main IPC, restauration de l'état de la
     * fenêtre, puis routage vers la vue correspondante.
     *
     * Chaque attente est bornée et toute erreur est rattrapée : sans cela, un pont
     * IPC qui ne répond pas laisse `isReady` à `false` indéfiniment, et l'écran de
     * chargement — un calque opaque plein écran qui recouvre jusqu'à la titlebar —
     * se présente à l'utilisateur comme une fenêtre entièrement blanche, dans le
     * même état après un Ctrl+Alt+R.
     */
    private async load(): Promise<void> {
        if (this.isReady()) {
            return;
        }

        this.startupError.set(null);

        try {
            await withTimeout(this.noxus.init(), BRIDGE_TIMEOUT_MS, "IPC bridge handshake");

            // Charger les infos de l'application
            const loadResult = await withTimeout(this.noxus.ipc.loadApp(), STARTUP_STEP_TIMEOUT_MS, "loadApp");
            this.state.appName.set(loadResult.appName);
            this.state.appVersion.set(loadResult.appVersion);

            const appState = await withTimeout(
                this.noxus.request<AppState>({ method: "GET", path: "app/state" }),
                STARTUP_STEP_TIMEOUT_MS,
                "app/state",
            );

            // Restaurer l'état de la fenêtre (transaction, etc.) depuis le main process
            const windowState = await withTimeout(
                this.noxus.ipc.getWindowState(),
                STARTUP_STEP_TIMEOUT_MS,
                "getWindowState",
            );
            this.dbService.inTransaction.set(windowState.inTransaction);

            this.isReady.set(true);

            // Précharger Monaco Editor en arrière-plan pour un affichage instantané
            this.monacoPreload.preload();

            this.routeToInitialView(appState);

            // La base passée en ligne de commande est ouverte une fois l'interface
            // prête, jamais avant : le main la met en attente plutôt que de la
            // pousser sur un minuteur qui pouvait expirer avant le renderer.
            if (loadResult.pendingFile) {
                void this.dbService.openFile(loadResult.pendingFile);
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error("Application startup failed:", error);
            this.startupError.set(message);
        }
    }

    /**
     * Route vers la vue initiale selon l'état restauré du main process.
     */
    private routeToInitialView(appState: AppState): void {
        if (this.pendingNavigationRequest) {
            this.router.navigateByUrl(this.pendingNavigationRequest);
            this.pendingNavigationRequest = null;
            return;
        }

        if (!appState.connected || !appState.database) {
            this.router.navigate(["/open-database"]);
            return;
        }

        this.state.connected.set(true);
        this.state.database.set(appState.database);
        this.state.filePath.set(appState.filePath);
        this.state.driverType.set(appState.driverType);
        this.state.driverInfo.set(appState.driverInfo);
        this.state.title.set(appState.database.name);
        this.state.fileName.set(appState.database.name);
        this.router.navigate(["/dashboard/no-table"]);

        // Recharger les procédures stockées si le driver les supporte (ex: après Ctrl+Alt+R)
        if (appState.driverInfo?.capabilities?.storedProcedures) {
            void this.storedProcService.loadProcedures();
        }
    }

    /**
     * Relance l'initialisation après un échec de démarrage.
     */
    protected retryStartup(): void {
        void this.load();
    }

    /**
     * Recharge complètement le renderer après un échec de démarrage.
     */
    protected reloadApplication(): void {
        void this.noxus.ipc.requestReload();
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

        // Ctrl+D : toggle mode édition (aka [D]esign Mode)
        if (event.ctrlKey && !event.altKey && event.key === "d") {
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

        // Ctrl+Shift+D : ouvrir le diff de session
        if (event.ctrlKey && !event.altKey && event.shiftKey && event.key === "D") {
            event.preventDefault();
            if (this.state.connected()) {
                this.tabsService.openTab(SESSION_DIFF_TAB_ID);
                this.dbService.selectedTable.set(null);
                this.router.navigate(["/dashboard/session-diff"]);
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

        // Ctrl+E : ouvrir la recherche d'entités (tables/procédures)
        if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key === "e") {
            event.preventDefault();
            if (this.state.connected()) {
                document.dispatchEvent(new CustomEvent("open-entity-search"));
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
