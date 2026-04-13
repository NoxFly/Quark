import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { DatabaseService } from "src/app/core/services/database.service";
import { StateService } from "src/app/core/services/state.service";

@Component({
    selector: "app-open-database",
    standalone: true,
    templateUrl: "./open-database.page.html",
    styleUrl: "./open-database.page.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule],
    host: {
        "(dragover)": "onDragOver($event)",
        "(dragleave)": "onDragLeave($event)",
        "(drop)": "onDrop($event)",
    },
})
export class OpenDatabasePage {
    private readonly dbService = inject(DatabaseService);
    protected readonly state = inject(StateService);

    protected readonly isDragging = signal<boolean>(false);
    protected readonly password = signal<string>("");
    protected readonly passwordError = signal<boolean>(false);
    protected readonly submitting = signal<boolean>(false);

    /**
     * Ouvre le dialogue de sélection de fichier natif.
     */
    protected async openFileExplorer(): Promise<void> {
        await this.dbService.openFileDialog();
    }

    /**
     * Soumet le mot de passe pour déchiffrer la base.
     */
    protected async submitPassword(): Promise<void> {
        const pwd = this.password();
        if (!pwd) {
            return;
        }

        this.submitting.set(true);
        this.passwordError.set(false);

        const success = await this.dbService.submitPassword(pwd);

        if (!success) {
            this.passwordError.set(true);
        }

        this.submitting.set(false);
    }

    /**
     * Gère le password submit via Enter.
     */
    protected onPasswordKeydown(event: KeyboardEvent): void {
        if (event.key === "Enter") {
            this.submitPassword();
        }
    }

    protected onDragOver(event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.isDragging.set(true);
    }

    protected onDragLeave(event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.isDragging.set(false);
    }

    protected async onDrop(event: DragEvent): Promise<void> {
        event.preventDefault();
        event.stopPropagation();
        this.isDragging.set(false);

        const files = event.dataTransfer?.files;
        if (files && files.length > 0) {
            const file = files[0];
            // Electron expose le path complet via la propriété `path`
            const filePath = (file as any).path as string;
            if (filePath) {
                await this.dbService.openFile(filePath);
            }
        }
    }
}
