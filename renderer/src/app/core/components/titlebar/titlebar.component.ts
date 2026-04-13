import { ChangeDetectionStrategy, Component, computed, inject, signal } from "@angular/core";
import { DatabaseService } from "src/app/core/services/database.service";
import { NoxusService } from "src/app/core/services/noxus.service";
import { StateService } from "src/app/core/services/state.service";
import { ThemeService } from "src/app/core/services/theme.service";

interface MenuItem {
    label: string;
    shortcut?: string;
    action?: () => void;
    separator?: boolean;
    disabled?: boolean;
}

interface Menu {
    label: string;
    items: MenuItem[];
}

@Component({
    selector: "app-titlebar",
    standalone: true,
    templateUrl: "./titlebar.component.html",
    styleUrl: "./titlebar.component.scss",
    imports: [],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        "(document:click)": "closeMenus()",
        "(window:keydown.escape)": "closeMenus()",
    },
})
export class TitlebarComponent {
    private readonly noxus = inject(NoxusService);
    private readonly dbService = inject(DatabaseService);
    protected readonly state = inject(StateService);
    protected readonly themeService = inject(ThemeService);

    protected readonly openMenuIndex = signal<number | null>(null);
    protected readonly fileName = computed(() => this.state.fileName());
    protected readonly appName = computed(() => this.state.appName());

    protected readonly menus = computed<Menu[]>(() => {
        const connected = this.state.connected();

        return [
            {
                label: "Fichier",
                items: [
                    { label: "Ouvrir...", shortcut: "Ctrl+O", action: () => this.dbService.openFileDialog() },
                    { label: "Nouvelle fenêtre", shortcut: "Ctrl+Shift+N", action: () => this.noxus.ipc.newWindow() },
                    { label: "", separator: true },
                    { label: "Rafraîchir", shortcut: "Ctrl+Shift+R", action: () => this.dbService.refreshDatabase(), disabled: !connected },
                    { label: "Fermer le fichier", shortcut: "Ctrl+W", action: () => this.dbService.closeFile(), disabled: !connected },
                    { label: "", separator: true },
                    { label: "Quitter", shortcut: "Alt+F4", action: () => this.noxus.ipc.quitApp() },
                ],
            },
            {
                label: "Édition",
                items: [
                    { label: "Démarrer une transaction", action: () => this.dbService.transactionAction("begin"), disabled: !connected || this.dbService.inTransaction() },
                    { label: "Valider la transaction", action: () => this.dbService.transactionAction("commit"), disabled: !this.dbService.inTransaction() },
                    { label: "Annuler la transaction", action: () => this.dbService.transactionAction("rollback"), disabled: !this.dbService.inTransaction() },
                    { label: "", separator: true },
                    { label: "Supprimer la sélection", action: () => this.dbService.deleteSelectedRows(), disabled: this.dbService.selectedRowIds().size === 0 },
                ],
            },
            {
                label: "Affichage",
                items: [
                    { label: "Plein écran", shortcut: "F11", action: () => this.noxus.ipc.toggleFullscreen() },
                    { label: "", separator: true },
                    { label: "Changer le thème", shortcut: "Ctrl+K Ctrl+T", action: () => this.openThemePicker() },
                ],
            },
            {
                label: "Exporter",
                items: [
                    { label: "Exporter en JSON", action: () => this.dbService.exportData("json", this.dbService.selectedRowIds().size > 0), disabled: !connected },
                    { label: "Exporter en CSV", action: () => this.dbService.exportData("csv", this.dbService.selectedRowIds().size > 0), disabled: !connected },
                ],
            },
            {
                label: "Aide",
                items: [
                    { label: "À propos", action: () => this.openAbout() },
                ],
            },
        ];
    });

    /**
     * Toggle un menu par son index.
     */
    protected toggleMenu(event: MouseEvent, index: number): void {
        event.stopPropagation();
        this.openMenuIndex.update(current => current === index ? null : index);
    }

    /**
     * Survol d'un menu quand un autre est déjà ouvert.
     */
    protected onMenuHover(index: number): void {
        if (this.openMenuIndex() !== null) {
            this.openMenuIndex.set(index);
        }
    }

    /**
     * Exécute l'action d'un item de menu.
     */
    protected executeMenuItem(event: MouseEvent, item: MenuItem): void {
        event.stopPropagation();
        if (item.disabled || item.separator || !item.action) {
            return;
        }
        item.action();
        this.closeMenus();
    }

    /**
     * Ferme tous les menus.
     */
    protected closeMenus(): void {
        this.openMenuIndex.set(null);
    }

    protected closeApp(): void {
        this.noxus.ipc.close();
    }

    protected reduceApp(): void {
        this.noxus.ipc.reduce();
    }

    protected toggleMaximize(): void {
        this.noxus.ipc.toggleMaximize();
    }

    /**
     * Ouvre le sélecteur de thème.
     * Dispatche un événement personnalisé sur le document pour que le composant ThemePicker le capte.
     */
    private openThemePicker(): void {
        document.dispatchEvent(new CustomEvent("open-theme-picker"));
    }

    /**
     * Ouvre la modale "À propos".
     * Dispatche un événement personnalisé pour que le composant AppComponent l'intercepte.
     */
    private openAbout(): void {
        document.dispatchEvent(new CustomEvent("open-about-dialog"));
    }
}
