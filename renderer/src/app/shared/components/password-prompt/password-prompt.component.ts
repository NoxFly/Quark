/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import {
    ChangeDetectionStrategy,
    Component,
    inject,
    signal,
    OnInit,
    OnDestroy,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { InputComponent } from "@ui/input/input.component";
import type { RecentDatabaseEntry } from "@shared/ipc-renderer";
import type { R_NetworkConnectBody } from "@shared/types";
import { DatabaseService } from "src/app/core/services/database.service";
import { I18nService } from "src/app/core/services/i18n.service";

/**
 * Action sheet demandant le mot de passe avant de reconnecter depuis l'historique.
 * S'ouvre via l'événement personnalisé `open-password-prompt` portant
 * un `RecentDatabaseEntry` en détail.
 * Fermeture : touche Escape ou clic en dehors du panneau.
 */
@Component({
    selector: "app-password-prompt",
    standalone: true,
    imports: [FormsModule, InputComponent],
    templateUrl: "./password-prompt.component.html",
    styleUrl: "./password-prompt.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        "(window:keydown)": "onKeydown($event)",
        "(click)": "close()",
    },
})
export class PasswordPromptComponent implements OnInit, OnDestroy {
    private readonly dbService = inject(DatabaseService);
    protected readonly i18n = inject(I18nService);

    protected readonly isOpen = signal<boolean>(false);
    protected readonly isLoading = signal<boolean>(false);
    protected readonly hasError = signal<boolean>(false);
    protected readonly password = signal<string>("");

    private entry: RecentDatabaseEntry | null = null;

    private readonly openHandler = (event: Event): void => {
        const detail = (event as CustomEvent<RecentDatabaseEntry>).detail;
        this.entry = detail;
        this.password.set("");
        this.hasError.set(false);
        this.isOpen.set(true);
    };

    public ngOnInit(): void {
        document.addEventListener("open-password-prompt", this.openHandler);
    }

    public ngOnDestroy(): void {
        document.removeEventListener("open-password-prompt", this.openHandler);
    }

    /**
     * Ferme le panneau sans action.
     */
    protected close(): void {
        this.isOpen.set(false);
        this.entry = null;
    }

    /**
     * Tente la connexion avec le mot de passe saisi.
     */
    protected async confirm(): Promise<void> {
        if (!this.entry || this.isLoading()) {
            return;
        }

        const pwd = this.password();

        this.isLoading.set(true);
        this.hasError.set(false);

        try {
            if (this.entry.connectionType === "file" && this.entry.filePath) {
                await this.dbService.openFileWithPassword(this.entry.filePath, pwd, this.entry.driverType);
            }
            else if (this.entry.connectionType === "network") {
                const body: R_NetworkConnectBody = {
                    driverType: this.entry.driverType,
                    host: this.entry.host ?? "",
                    port: this.entry.port ?? 0,
                    username: this.entry.username ?? "",
                    password: pwd,
                    database: this.entry.database ?? "",
                };
                await this.dbService.connectNetwork(body);
            }

            this.close();
        }
        catch {
            this.hasError.set(true);
        }
        finally {
            this.isLoading.set(false);
        }
    }

    /**
     * Met à jour le signal mot de passe depuis l'input.
     */
    protected onPasswordInput(event: Event): void {
        this.password.set((event.target as HTMLInputElement).value);
        if (this.hasError()) {
            this.hasError.set(false);
        }
    }

    /**
     * Gère les touches clavier.
     */
    protected onKeydown(event: KeyboardEvent): void {
        if (!this.isOpen()) {
            return;
        }

        if (event.key === "Escape") {
            event.preventDefault();
            this.close();
        }
    }

    /**
     * Empêche la propagation du clic depuis le panneau vers l'overlay.
     */
    protected stopPropagation(event: MouseEvent): void {
        event.stopPropagation();
    }

    /**
     * Soumet le formulaire par la touche Enter dans l'input.
     */
    protected onInputKeydown(event: KeyboardEvent): void {
        if (event.key === "Enter") {
            event.preventDefault();
            void this.confirm();
        }
    }
}
