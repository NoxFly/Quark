/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, output, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import type { AzureAuthMode, ConnectionProfile, ConnectionProfileInput } from "@shared/connection";
import type { DriverInfo } from "@shared/driver";
import { I18nService } from "src/app/core/services/i18n.service";
import { NoxusService } from "src/app/core/services/noxus.service";
import { ButtonComponent } from "@ui/button/button.component";
import { SelectComponent } from "@ui/select/select.component";
import { SelectOptionComponent } from "@ui/select/select-option/select-option.component";

/**
 * Formulaire de création / édition d'un profil de connexion.
 *
 * Affiche les champs adaptés au driver sélectionné (fichier vs réseau).
 * Le mot de passe est « write-only » : en édition, un champ vide conserve le
 * secret existant (placeholder « inchangé »).
 */
@Component({
    selector: "app-connection-form",
    standalone: true,
    templateUrl: "./connection-form.component.html",
    styleUrl: "./connection-form.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, ButtonComponent, SelectComponent, SelectOptionComponent],
})
export class ConnectionFormComponent implements OnInit {
    private readonly noxus = inject(NoxusService);
    protected readonly i18n = inject(I18nService);

    /** Profil à éditer ; `null` pour une création. */
    public readonly profile = input<ConnectionProfile | null>(null);
    /** Liste de tous les drivers disponibles. */
    public readonly driverInfos = input<DriverInfo[]>([]);

    public readonly save = output<ConnectionProfileInput>();
    public readonly cancel = output<void>();

    protected readonly name = signal<string>("");
    protected readonly color = signal<string>("");
    protected readonly driverType = signal<string>("sqlite");
    protected readonly filePath = signal<string>("");
    protected readonly host = signal<string>("localhost");
    protected readonly port = signal<number>(0);
    protected readonly username = signal<string>("");
    protected readonly database = signal<string>("");
    protected readonly password = signal<string>("");
    protected readonly authMode = signal<AzureAuthMode>("sql");
    protected readonly clientId = signal<string>("");
    protected readonly tenantId = signal<string>("");

    /** Driver actuellement sélectionné. */
    protected readonly selectedDriver = computed<DriverInfo | undefined>(() =>
        this.driverInfos().find(d => d.type === this.driverType()),
    );

    /** Vrai si le driver sélectionné est une connexion réseau. */
    protected readonly isNetwork = computed<boolean>(() =>
        this.selectedDriver()?.capabilities.networkConnection ?? false,
    );

    /** Vrai si le driver sélectionné est Azure SQL. */
    protected readonly isAzure = computed<boolean>(() => this.driverType() === "azure");

    /** Vrai si l'authentification par principal de service (Entra ID) est sélectionnée. */
    protected readonly isServicePrincipal = computed<boolean>(() => this.isAzure() && this.authMode() === "service-principal");

    /** Vrai en mode édition (un profil existant est fourni). */
    protected readonly isEditing = computed<boolean>(() => this.profile() !== null);

    protected get canSubmit(): boolean {
        if (!this.name().trim()) {
            return false;
        }
        if (this.isNetwork()) {
            if (this.isServicePrincipal()) {
                if (!this.clientId().trim() || !this.tenantId().trim()) {
                    return false;
                }
                // Le client secret est requis sauf en édition d'un profil qui en a déjà un.
                if (!this.password() && !(this.isEditing() && (this.profile()?.hasPassword ?? false))) {
                    return false;
                }
            }
            return !!this.host().trim() && !!this.database().trim();
        }
        return !!this.filePath().trim();
    }

    public ngOnInit(): void {
        const profile = this.profile();
        if (profile) {
            this.name.set(profile.name);
            this.color.set(profile.color ?? "");
            this.driverType.set(profile.driverType);
            this.filePath.set(profile.filePath ?? "");
            this.host.set(profile.host ?? "localhost");
            this.port.set(profile.port ?? this.selectedDriver()?.defaultPort ?? 0);
            this.username.set(profile.username ?? "");
            this.database.set(profile.database ?? "");
            this.authMode.set(profile.authMode ?? "sql");
            this.clientId.set(profile.clientId ?? "");
            this.tenantId.set(profile.tenantId ?? "");
        }
    }

    /**
     * Change le driver et ajuste le port par défaut pour une connexion réseau.
     */
    protected onDriverChange(type: string): void {
        this.driverType.set(type);
        const driver = this.selectedDriver();
        if (driver?.capabilities.networkConnection && this.port() === 0) {
            this.port.set(driver.defaultPort ?? 0);
        }
    }

    /**
     * Ouvre le sélecteur de fichier natif pour une connexion fichier.
     */
    protected async pickFile(): Promise<void> {
        const path = await this.noxus.ipc.openFileDialog();
        if (path) {
            this.filePath.set(path);
            if (!this.name().trim()) {
                const parts = path.replace(/\\/g, "/").split("/");
                this.name.set(parts[parts.length - 1] ?? path);
            }
        }
    }

    /**
     * Émet le profil saisi vers le parent.
     */
    protected submit(): void {
        if (!this.canSubmit) {
            return;
        }

        const driver = this.selectedDriver();
        const isNetwork = this.isNetwork();
        const pwd = this.password();

        const input: ConnectionProfileInput = {
            name: this.name().trim(),
            color: this.color() || undefined,
            driverType: (driver?.type ?? "sqlite"),
            connectionType: isNetwork ? "network" : "file",
            // Mot de passe write-only : en édition, champ vide = inchangé.
            password: this.isEditing() && pwd === "" ? undefined : pwd,
        };

        if (isNetwork) {
            input.host = this.host().trim();
            input.port = Number(this.port());
            input.database = this.database().trim();

            if (this.isServicePrincipal()) {
                // Principal de service : pas d'identifiant utilisateur ; le secret
                // (clientSecret) voyage via le champ `password` write-only.
                input.authMode = "service-principal";
                input.clientId = this.clientId().trim();
                input.tenantId = this.tenantId().trim();
            }
            else {
                input.username = this.username().trim();
                if (this.isAzure()) {
                    input.authMode = "sql";
                }
            }
        }
        else {
            input.filePath = this.filePath().trim();
        }

        this.save.emit(input);
    }
}
