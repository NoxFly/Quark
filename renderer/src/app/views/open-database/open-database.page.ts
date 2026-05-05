/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import type { DatabaseDriverType, DriverInfo } from "@shared/driver";
import { DatabaseService } from "src/app/core/services/database.service";
import { NoxusService } from "src/app/core/services/noxus.service";
import { StateService } from "src/app/core/services/state.service";
import { extractIpcErrorMessage } from "src/app/shared/helpers/utils";
import { TranslatePipe } from "src/app/shared/pipes/translate.pipe";

/** Chemins des logos PNG par type de driver. */
const DRIVER_LOGOS: Record<DatabaseDriverType, string> = {
    sqlite:     "images/logo-sqlite.png",
    mysql:      "images/logo-mysql-mariadb.png",
    postgresql: "images/logo-postgresql.png",
    oracle:     "images/logo-oracle.png",
    mssql:      "images/logo-mssql.png",
    mongodb:    "images/logo-mongodb.png",
};

/** Couleurs accent par type de driver. */
const DRIVER_COLORS: Record<DatabaseDriverType, string> = {
    sqlite:     "#08425e",
    mysql:      "#e48e00",
    postgresql: "#44668c",
    oracle:     "#c84b3a",
    mssql:      "#5397da",
    mongodb:    "#086c4f",
};

@Component({
    selector: "app-open-database",
    standalone: true,
    templateUrl: "./open-database.page.html",
    styleUrl: "./open-database.page.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, TranslatePipe],
    host: {
        "(dragover)": "onDragOver($event)",
        "(dragleave)": "onDragLeave($event)",
        "(drop)": "onDrop($event)",
    },
})
export class OpenDatabasePage implements OnInit {
    private readonly dbService = inject(DatabaseService);
    private readonly noxus = inject(NoxusService);
    protected readonly state = inject(StateService);

    protected readonly isDragging = signal<boolean>(false);
    protected readonly password = signal<string>("");
    protected readonly passwordError = signal<boolean>(false);
    protected readonly submitting = signal<boolean>(false);

    /** Liste des drivers réseau (hors SQLite). */
    protected readonly networkDrivers = signal<DriverInfo[]>([]);

    /** Driver réseau sélectionné (formulaire de connexion visible). */
    protected readonly selectedDriver = signal<DriverInfo | null>(null);

    /** Champs du formulaire réseau. */
    protected readonly networkHost = signal<string>("localhost");
    protected readonly networkPort = signal<number>(3306);
    protected readonly networkUser = signal<string>("");
    protected readonly networkPassword = signal<string>("");
    protected readonly networkDatabase = signal<string>("");
    protected readonly networkError = signal<string | null>(null);
    protected readonly networkConnecting = signal<boolean>(false);

    public readonly driverLogos = DRIVER_LOGOS;
    public readonly driverColors = DRIVER_COLORS;

    public async ngOnInit(): Promise<void> {
        try {
            const infos = await this.noxus.ipc.getAllDriverInfos();
            // Filtrer uniquement les drivers réseau
            this.networkDrivers.set(infos.filter(d => d.capabilities.networkConnection));
        }
        catch {
            // Fallback si l'IPC échoue
        }
    }

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
            void this.submitPassword();
        }
    }

    /**
     * Sélectionne un driver réseau et ouvre le formulaire de connexion.
     */
    protected selectDriver(driver: DriverInfo): void {
        this.selectedDriver.set(driver);
        this.networkPort.set(driver.defaultPort ?? 5432);
        this.networkError.set(null);
        this.networkConnecting.set(false);
    }

    /**
     * Ferme le formulaire de connexion réseau.
     */
    protected cancelNetworkForm(): void {
        this.selectedDriver.set(null);
        this.networkError.set(null);
        this.networkConnecting.set(false);
    }

    /**
     * Connecte à la base réseau.
     */
    protected async connectNetwork(): Promise<void> {
        const driver = this.selectedDriver();
        if (!driver) {
            return;
        }

        this.networkConnecting.set(true);
        this.networkError.set(null);

        try {
            await this.dbService.connectNetwork({
                driverType: driver.type,
                host: this.networkHost(),
                port: this.networkPort(),
                username: this.networkUser(),
                password: this.networkPassword(),
                database: this.networkDatabase(),
            });
            this.selectedDriver.set(null);
        }
        catch (err) {
            this.networkError.set(extractIpcErrorMessage(err));
        }
        finally {
            this.networkConnecting.set(false);
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
            if (file) {
                const filePath = this.noxus.ipc.getFilePathFromDrop(file);
                if (filePath) {
                    await this.dbService.openFile(filePath);
                }
            }
        }
    }
}

