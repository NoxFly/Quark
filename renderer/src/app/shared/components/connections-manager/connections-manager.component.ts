/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import type { ConnectionProfile, ConnectionProfileInput } from "@shared/connection";
import type { DriverInfo } from "@shared/driver";
import { ConnectionsService } from "src/app/core/services/connections.service";
import { I18nService } from "src/app/core/services/i18n.service";
import { NoxusService } from "src/app/core/services/noxus.service";
import { ButtonComponent } from "@ui/button/button.component";
import { InputComponent } from "@ui/input/input.component";
import { ConnectionFormComponent } from "src/app/shared/components/connection-form/connection-form.component";

/** Vue active du gestionnaire. */
type ManagerView = "loading" | "init" | "unlock" | "list" | "form";

/** État de la saisie de passphrase pour l'export / import. */
interface PassphrasePrompt {
    mode: "export" | "import";
    ids: string[];
}

/**
 * Gestionnaire de connexions sauvegardées (File > Connections).
 *
 * Orchestre les états du coffre chiffré : définition du mot de passe maître,
 * déverrouillage, liste/administration des profils, et export/import de profils
 * chiffrés par passphrase pour le partage.
 */
@Component({
    selector: "app-connections-manager",
    standalone: true,
    templateUrl: "./connections-manager.component.html",
    styleUrl: "./connections-manager.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, ButtonComponent, InputComponent, ConnectionFormComponent],
})
export class ConnectionsManagerComponent implements OnInit {
    private readonly connections = inject(ConnectionsService);
    private readonly noxus = inject(NoxusService);
    protected readonly i18n = inject(I18nService);

    /** Callback de fermeture, fourni par l'ouvreur du modal. */
    public dismiss?: () => void;

    protected readonly view = signal<ManagerView>("loading");
    protected readonly driverInfos = signal<DriverInfo[]>([]);
    protected readonly editingProfile = signal<ConnectionProfile | null>(null);

    protected readonly masterPassword = signal<string>("");
    protected readonly confirmPassword = signal<string>("");
    protected readonly errorMessage = signal<string | null>(null);
    protected readonly feedback = signal<string | null>(null);
    protected readonly busy = signal<boolean>(false);

    protected readonly passphrasePrompt = signal<PassphrasePrompt | null>(null);
    protected readonly passphrase = signal<string>("");

    /** Profils exposés depuis le service. */
    protected get profiles(): ConnectionProfile[] {
        return this.connections.profiles();
    }

    protected get canInit(): boolean {
        return this.masterPassword().length >= 4 && this.masterPassword() === this.confirmPassword();
    }

    public async ngOnInit(): Promise<void> {
        try {
            this.driverInfos.set(await this.noxus.ipc.getAllDriverInfos());
        }
        catch {
            // Fallback silencieux si l'IPC échoue
        }

        const status = await this.connections.refreshStatus();
        if (!status.initialized) {
            this.view.set("init");
        }
        else if (status.unlocked) {
            await this.connections.loadProfiles();
            this.view.set("list");
        }
        else {
            this.view.set("unlock");
        }
    }

    /**
     * Définit le mot de passe maître et initialise le coffre.
     */
    protected async initVault(): Promise<void> {
        if (!this.canInit) {
            return;
        }
        this.busy.set(true);
        this.errorMessage.set(null);
        try {
            await this.connections.initialize(this.masterPassword());
            this.resetSecrets();
            this.view.set("list");
        }
        catch (err) {
            this.errorMessage.set(err instanceof Error ? err.message : String(err));
        }
        finally {
            this.busy.set(false);
        }
    }

    /**
     * Déverrouille le coffre avec le mot de passe maître saisi.
     */
    protected async unlockVault(): Promise<void> {
        if (!this.masterPassword()) {
            return;
        }
        this.busy.set(true);
        this.errorMessage.set(null);
        try {
            const ok = await this.connections.unlock(this.masterPassword());
            if (ok) {
                this.resetSecrets();
                this.view.set("list");
            }
            else {
                this.errorMessage.set(this.i18n.t("connections.wrongPassword"));
            }
        }
        finally {
            this.busy.set(false);
        }
    }

    /**
     * Verrouille le coffre et revient à l'écran de déverrouillage.
     */
    protected async lockVault(): Promise<void> {
        await this.connections.lock();
        this.resetSecrets();
        this.view.set("unlock");
    }

    /**
     * Ouvre le formulaire de création.
     */
    protected openCreate(): void {
        this.editingProfile.set(null);
        this.view.set("form");
    }

    /**
     * Ouvre le formulaire d'édition d'un profil.
     */
    protected openEdit(profile: ConnectionProfile): void {
        this.editingProfile.set(profile);
        this.view.set("form");
    }

    /**
     * Persiste le profil saisi (création ou édition).
     */
    protected async saveProfile(input: ConnectionProfileInput): Promise<void> {
        const editing = this.editingProfile();
        if (editing) {
            await this.connections.update(editing.id, input);
        }
        else {
            await this.connections.create(input);
        }
        this.view.set("list");
    }

    /**
     * Supprime un profil après confirmation.
     */
    protected async deleteProfile(profile: ConnectionProfile): Promise<void> {
        if (!confirm(this.i18n.t("connections.confirmDelete"))) {
            return;
        }
        await this.connections.remove(profile.id);
    }

    /**
     * Connecte la fenêtre au profil et ferme le gestionnaire.
     */
    protected async connectProfile(profile: ConnectionProfile): Promise<void> {
        await this.connections.connect(profile);
        this.dismiss?.();
    }

    /**
     * Démarre l'export d'un profil (saisie de passphrase).
     */
    protected startExport(profile: ConnectionProfile): void {
        this.feedback.set(null);
        this.passphrase.set("");
        this.passphrasePrompt.set({ mode: "export", ids: [profile.id] });
    }

    /**
     * Démarre l'import d'un fichier de profils (saisie de passphrase).
     */
    protected startImport(): void {
        this.feedback.set(null);
        this.passphrase.set("");
        this.passphrasePrompt.set({ mode: "import", ids: [] });
    }

    /**
     * Valide la saisie de passphrase et lance l'export ou l'import.
     */
    protected async confirmPassphrase(): Promise<void> {
        const prompt = this.passphrasePrompt();
        if (!prompt || !this.passphrase()) {
            return;
        }

        this.busy.set(true);
        this.errorMessage.set(null);
        try {
            if (prompt.mode === "export") {
                const ok = await this.connections.exportProfiles(prompt.ids, this.passphrase());
                this.feedback.set(ok ? this.i18n.t("connections.exportDone") : null);
            }
            else {
                const count = await this.connections.importProfiles(this.passphrase());
                this.feedback.set(this.i18n.t("connections.importDone").replace("{count}", String(count)));
            }
            this.passphrasePrompt.set(null);
            this.passphrase.set("");
        }
        catch {
            this.errorMessage.set(this.i18n.t("connections.wrongPassphrase"));
        }
        finally {
            this.busy.set(false);
        }
    }

    /**
     * Annule la saisie de passphrase.
     */
    protected cancelPassphrase(): void {
        this.passphrasePrompt.set(null);
        this.passphrase.set("");
    }

    /**
     * Sous-titre descriptif d'un profil pour la liste.
     */
    protected subtitle(profile: ConnectionProfile): string {
        if (profile.connectionType === "network") {
            return `${profile.username ?? ""}@${profile.host ?? ""}:${profile.port ?? ""}/${profile.database ?? ""}`;
        }
        return profile.filePath ?? "";
    }

    /**
     * Nom affiché du driver d'un profil.
     */
    protected driverName(profile: ConnectionProfile): string {
        return this.driverInfos().find(d => d.type === profile.driverType)?.displayName ?? profile.driverType;
    }

    private resetSecrets(): void {
        this.masterPassword.set("");
        this.confirmPassword.set("");
        this.errorMessage.set(null);
    }
}
