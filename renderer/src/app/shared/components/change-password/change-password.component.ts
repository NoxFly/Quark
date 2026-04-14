/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { DatabaseService } from "src/app/core/services/database.service";
import { I18nService } from "src/app/core/services/i18n.service";
import { ButtonComponent } from "@ui/button/button.component";

/**
 * Modal pour changer ou supprimer le mot de passe SQLCipher.
 * - Chiffrer une base non chiffrée
 * - Changer le mot de passe d'une base chiffrée
 * - Supprimer le chiffrement d'une base chiffrée
 */
@Component({
    selector: "app-change-password",
    standalone: true,
    templateUrl: "./change-password.component.html",
    styleUrl: "./change-password.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, ButtonComponent],
})
export class ChangePasswordComponent {
    private readonly dbService = inject(DatabaseService);
    protected readonly i18n = inject(I18nService);

    /** Callback de fermeture. */
    public dismiss?: (data?: { changed: boolean } | null) => void;

    protected readonly mode = signal<"set" | "remove">("set");
    protected readonly newPassword = signal<string>("");
    protected readonly confirmPassword = signal<string>("");
    protected readonly isSaving = signal<boolean>(false);
    protected readonly errorMessage = signal<string | null>(null);
    protected readonly success = signal<boolean>(false);

    protected get passwordsMatch(): boolean {
        return this.newPassword() === this.confirmPassword();
    }

    protected get canSubmit(): boolean {
        if (this.mode() === "remove") {
            return true;
        }
        const pwd = this.newPassword();
        return pwd.length >= 4 && this.passwordsMatch;
    }

    /**
     * Applique le changement de mot de passe.
     */
    protected async apply(): Promise<void> {
        if (!this.canSubmit) {
            return;
        }

        this.isSaving.set(true);
        this.errorMessage.set(null);

        try {
            const newPwd = this.mode() === "remove" ? null : this.newPassword();
            await this.dbService.changePassword(newPwd);
            this.success.set(true);
        }
        catch (err) {
            this.errorMessage.set(err instanceof Error ? err.message : String(err));
        }
        finally {
            this.isSaving.set(false);
        }
    }

    protected close(changed: boolean): void {
        this.dismiss?.({ changed });
    }
}
