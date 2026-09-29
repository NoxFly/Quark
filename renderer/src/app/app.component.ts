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
import { ThemeService } from "src/app/core/services/theme.service";
import { MonacoPreloadService } from "src/app/core/services/monaco-preload.service";
import { ShellService } from "src/app/core/services/shell.service";
import { SidebarComponent } from "./core/components/sidebar/sidebar.component";
import { StatusbarComponent } from "./core/components/statusbar/statusbar.component";
import { TabsBarComponent } from "./core/components/tabs-bar/tabs-bar.component";
import { TitlebarComponent } from "./core/components/titlebar/titlebar.component";
import { TransactionBannerComponent } from "./core/components/transaction-banner/transaction-banner.component";
import { LoadingScreenComponent } from "./shared/components/loading-screen/loading-screen.component";
import { ThemePickerComponent } from "./shared/components/theme-picker/theme-picker.component";
import { RecentDatabasesComponent } from "./shared/components/recent-databases/recent-databases.component";
import { PasswordPromptComponent } from "./shared/components/password-prompt/password-prompt.component";
import { StartupErrorComponent } from "./shared/components/startup-error/startup-error.component";
import { EntitySearchComponent } from "./shared/components/entity-search/entity-search.component";
import { StoredProceduresService } from "src/app/core/services/stored-procedures.service";
import { SessionDiffService } from "src/app/core/services/session-diff.service";
import { UpdateService } from "src/app/core/services/update.service";
import { SettingsPage } from "src/app/views/settings/settings.page";
import { withTimeout } from "src/app/shared/helpers/global.helper";
import { isTextEntryTarget } from "src/app/shared/helpers/shortcut.helper";

/**
 * Échéance de la poignée de main du pont IPC. Plus large que les autres étapes :
 * elle inclut le démarrage du process main sur une machine froide.
 */
const BRIDGE_TIMEOUT_MS = 20_000;

/** Échéance de chaque requête d'initialisation qui suit la poignée de main. */
const STARTUP_STEP_TIMEOUT_MS = 15_000;

/** Délai laissé pour la seconde touche d'un accord `Ctrl+K …`. */
const CHORD_TIMEOUT_MS = 1000;


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
        TransactionBannerComponent,
        SettingsPage,
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
    protected readonly dbService = inject(DatabaseService);
    protected readonly shell = inject(ShellService);
    private readonly themeService = inject(ThemeService);
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

        // Les composants qui ne dépendent pas de la coquille (sidebar, pages, accueil)
        // demandent ses modales et vues par des évènements du document.
        const shellEvents: Record<string, () => void> = {
            "open-about-dialog": () => void this.shell.openAbout(),
            "open-shortcuts": () => void this.shell.openShortcuts(),
            "open-settings": () => this.shell.openSettings(),
            "open-connections-manager": () => void this.shell.openConnectionsManager(),
            "open-create-table": () => void this.shell.openCreateTable(),
            "open-change-password": () => void this.shell.openChangePassword(),
            "open-schema-editor": () => void this.shell.openSchemaEditor(),
            "open-index-viewer": () => void this.shell.openIndexViewer(),
        };

        for (const [name, handler] of Object.entries(shellEvents)) {
            document.addEventListener(name, handler);
        }

        this.destroyRef.onDestroy(() => {
            for (const [name, handler] of Object.entries(shellEvents)) {
                document.removeEventListener(name, handler);
            }
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
     *
     * Une touche déjà traitée par un composant (éditeur Monaco, champ de saisie
     * qui annule l'évènement) n'est pas réinterprétée ici : Ctrl+D ou Ctrl+Entrée
     * y ont leur propre sens.
     */
    protected handleKeydown(event: KeyboardEvent): void {
        if (event.defaultPrevented) {
            return;
        }

        if (this.handleChord(event)) {
            event.preventDefault();
            return;
        }

        const handler = this.shortcutHandlers[this.shortcutOf(event)];

        if (handler?.(event)) {
            event.preventDefault();
        }
    }

    /**
     * Accords `Ctrl+K …` : `Ctrl+K Ctrl+T` (sélecteur de thème), `Ctrl+K Ctrl+F` (fermer la base).
     * @returns `true` si la touche fait partie d'un accord.
     */
    private handleChord(event: KeyboardEvent): boolean {
        const key = event.key.toLowerCase();

        if (this.ctrlKPressed && event.ctrlKey && (key === "t" || key === "f")) {
            this.ctrlKPressed = false;

            if (key === "t") {
                document.dispatchEvent(new CustomEvent("open-theme-picker"));
            }
            else if (this.state.connected()) {
                void this.dbService.closeFile();
            }

            return true;
        }

        if (event.ctrlKey && !event.shiftKey && !event.altKey && key === "k") {
            this.ctrlKPressed = true;
            setTimeout(() => { this.ctrlKPressed = false; }, CHORD_TIMEOUT_MS);
            return true;
        }

        if (!["Control", "Shift", "Alt"].includes(event.key)) {
            this.ctrlKPressed = false;
        }

        return false;
    }

    /**
     * Combinaison neutre d'un évènement (« Ctrl+Shift+S »), celle d'`APP_SHORTCUTS`.
     * Maj n'est retenue que pour les lettres et les touches nommées : sur un clavier
     * AZERTY, « / » s'obtient avec Maj, et Ctrl+/ doit fonctionner partout.
     */
    private shortcutOf(event: KeyboardEvent): string {
        const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
        const shiftMatters = /^[A-Z]$/.test(key) || key.length > 1;
        const parts = [
            event.ctrlKey || event.metaKey ? "Ctrl" : "",
            event.altKey ? "Alt" : "",
            event.shiftKey && shiftMatters ? "Shift" : "",
            key,
        ];

        return parts.filter(part => part !== "").join("+");
    }

    /**
     * Action de chaque raccourci global. Un gestionnaire renvoie `true` s'il a
     * traité la touche (le comportement par défaut est alors empêché).
     *
     * Anciennes combinaisons conservées en alias, faute de conflit : Ctrl+Maj+R
     * (rafraîchir), Ctrl+Maj+Q (éditeur SQL), Ctrl+D (mode édition).
     */
    private readonly shortcutHandlers: Readonly<Record<string, (event: KeyboardEvent) => boolean>> = {
        "Ctrl+O": () => this.run(() => void this.dbService.openFileDialog()),
        "Ctrl+Shift+C": () => this.run(() => void this.shell.openConnectionsManager()),
        "Ctrl+R": () => this.run(() => document.dispatchEvent(new CustomEvent("open-recent-databases"))),
        "Ctrl+Alt+R": () => this.run(() => void this.noxus.ipc.requestReload()),
        "Ctrl+Shift+N": () => this.run(() => void this.noxus.ipc.newWindow()),
        "F5": () => this.run(() => void this.shell.refresh()),
        "Ctrl+Shift+R": () => this.run(() => void this.shell.refresh()),
        "Ctrl+W": () => this.run(() => void this.shell.closeActiveTab()),
        "F11": () => this.run(() => this.shell.toggleFullscreen()),
        "Ctrl+/": () => this.run(() => void this.shell.openShortcuts()),
        "Ctrl+,": () => this.run(() => this.shell.toggleSettings()),
        "Ctrl+P": () => this.whenConnected(() => document.dispatchEvent(new CustomEvent("open-entity-search"))),
        "Ctrl+Shift+S": () => this.whenConnected(() => this.shell.openSqlEditor()),
        "Ctrl+Shift+Q": () => this.whenConnected(() => this.shell.openSqlEditor()),
        "Ctrl+Shift+D": () => this.whenConnected(() => this.shell.openErDiagram()),
        "Ctrl+Shift+M": () => this.whenConnected(() => this.shell.openSessionDiff()),
        "Ctrl+E": () => this.whenConnected(() => this.dbService.toggleReadOnly()),
        "Ctrl+D": () => this.whenConnected(() => this.dbService.toggleReadOnly()),
        "Ctrl+T": () => this.whenConnected(() => {
            if (!this.dbService.inTransaction()) {
                void this.dbService.transactionAction("begin");
            }
        }),
        "Ctrl+Enter": () => this.commitFromKeyboard(),
        "Ctrl+Shift+Z": event => !isTextEntryTarget(event.target) && this.whenConnected(() => {
            if (this.dbService.inTransaction()) {
                void this.dbService.transactionAction("rollback");
            }
        }),
        "Ctrl+Z": event => !isTextEntryTarget(event.target) && this.whenConnected(() => {
            if (this.dbService.mutationHistory.canUndo()) {
                void this.dbService.undoLastMutation();
            }
        }),
        "Ctrl+Y": event => !isTextEntryTarget(event.target) && this.whenConnected(() => {
            if (this.dbService.mutationHistory.canRedo()) {
                void this.dbService.redoLastMutation();
            }
        }),
        "Delete": event => this.deleteSelectionFromKeyboard(event),
        "Ctrl+N": event => this.newRecordFromKeyboard(event),
    };

    /**
     * Exécute une action de raccourci toujours disponible.
     */
    private run(action: () => void): boolean {
        action();
        return true;
    }

    /**
     * Exécute une action de raccourci qui n'a de sens qu'avec une base ouverte.
     * La touche est tout de même consommée, pour ne pas déclencher le
     * comportement par défaut de Chromium (Ctrl+P imprime, Ctrl+D ajoute un favori…).
     */
    private whenConnected(action: () => void): boolean {
        if (this.state.connected()) {
            action();
        }

        return true;
    }

    /**
     * Ctrl+Entrée valide la transaction, sauf dans les éditeurs de code (éditeur
     * SQL, procédure stockée) où la même combinaison exécute le script.
     */
    private commitFromKeyboard(): boolean {
        const url = this.router.url;

        if (!this.state.connected() || !this.dbService.inTransaction()
            || url.includes("/sql-editor") || url.includes("/stored-procedure")) {
            return false;
        }

        void this.dbService.transactionAction("commit");
        return true;
    }

    /**
     * Suppr supprime les lignes sélectionnées de la table affichée, hors saisie de texte.
     */
    private deleteSelectionFromKeyboard(event: KeyboardEvent): boolean {
        if (isTextEntryTarget(event.target) || !this.canEditActiveTable() || this.dbService.selectedCount() === 0) {
            return false;
        }

        void this.dbService.deleteSelectedRows();
        return true;
    }

    /**
     * Ctrl+N demande l'ouverture du formulaire de nouvel enregistrement à la vue table,
     * qui détient l'éditeur d'enregistrement.
     */
    private newRecordFromKeyboard(event: KeyboardEvent): boolean {
        if (isTextEntryTarget(event.target) || !this.canEditActiveTable()) {
            return false;
        }

        document.dispatchEvent(new CustomEvent("open-new-record"));
        return true;
    }

    /**
     * Une table (et non un onglet spécial) est affichée et la base est en mode édition.
     */
    private canEditActiveTable(): boolean {
        const table = this.dbService.selectedTable();

        return this.state.connected() && !this.dbService.readOnly() && table !== null;
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
}
