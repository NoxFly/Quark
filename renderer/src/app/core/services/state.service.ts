import { computed, Injectable, signal } from "@angular/core";
import type { DatabaseSchema } from "@shared/types";
import type { DatabaseDriverType, DriverCapabilities, DriverInfo } from "@shared/driver";

@Injectable({ providedIn: "root" })
export class StateService {
    public readonly connected = signal<boolean>(false);
    public readonly database = signal<DatabaseSchema | null>(null);
    public readonly filePath = signal<string | null>(null);
    public readonly needsPassword = signal<boolean>(false);
    public readonly pendingFilePath = signal<string | null>(null);
    public readonly title = signal<string>("SQLite Editor");
    public readonly appName = signal<string>("SQLite Editor");
    public readonly appVersion = signal<string>("");
    public readonly fileName = signal<string>("");

    /** Type du driver actif (null si pas connecté). */
    public readonly driverType = signal<DatabaseDriverType | null>(null);

    /** Informations complètes du driver actif. */
    public readonly driverInfo = signal<DriverInfo | null>(null);

    /** Nom affiché du driver actif. */
    public readonly driverDisplayName = computed(() => this.driverInfo()?.displayName ?? null);

    /** Indique si la base courante est SQL. */
    public readonly isSqlDatabase = computed(() => this.driverInfo()?.category === "sql");

    /** Indique si la base courante est NoSQL. */
    public readonly isNoSqlDatabase = computed(() => this.driverInfo()?.category === "nosql");

    /** Capacités du driver actif (null si pas connecté). */
    public readonly capabilities = computed<DriverCapabilities | null>(() => this.driverInfo()?.capabilities ?? null);
}
