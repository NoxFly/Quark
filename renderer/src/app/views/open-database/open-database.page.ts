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

import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import type { DatabaseDriverType, DriverInfo } from "@shared/driver";
import type { AzureAuthMode } from "@shared/connection";
import { DatabaseService } from "src/app/core/services/database.service";
import { NoxusService } from "src/app/core/services/noxus.service";
import { StateService } from "src/app/core/services/state.service";
import { extractIpcErrorMessage } from "src/app/shared/helpers/utils";
import { TranslatePipe } from "src/app/shared/pipes/translate.pipe";
import { SelectComponent } from "@ui/select/select.component";
import { SelectOptionComponent } from "@ui/select/select-option/select-option.component";
import { ButtonComponent } from "@ui/button/button.component";
import { InputComponent } from "@ui/input/input.component";

/** Chemins des logos PNG par type de driver. */
const DRIVER_LOGOS: Record<DatabaseDriverType, string> = {
    sqlite:     "images/logo-sqlite.png",
    mysql:      "images/logo-mysql-mariadb.png",
    postgresql: "images/logo-postgresql.png",
    oracle:     "images/logo-oracle.png",
    mssql:      "images/logo-mssql.png",
    azure:      "images/logo-azure.png",
    mongodb:    "images/logo-mongodb.png",
};

/** Couleurs accent par type de driver. */
const DRIVER_COLORS: Record<DatabaseDriverType, string> = {
    sqlite:     "#08425e",
    mysql:      "#e48e00",
    postgresql: "#44668c",
    oracle:     "#c84b3a",
    mssql:      "#5397da",
    azure:      "#0078d4",
    mongodb:    "#086c4f",
};

@Component({
    selector: "app-open-database",
    standalone: true,
    templateUrl: "./open-database.page.html",
    styleUrl: "./open-database.page.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, TranslatePipe, SelectComponent, SelectOptionComponent, ButtonComponent, InputComponent],
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

    /** Champs Azure : mode d'authentification et identifiants Entra ID. */
    protected readonly authMode = signal<AzureAuthMode>("sql");
    protected readonly clientId = signal<string>("");
    protected readonly tenantId = signal<string>("");

    /** Vrai si le driver réseau sélectionné est Azure SQL. */
    protected readonly isAzure = computed<boolean>(() => this.selectedDriver()?.type === "azure");

    /** Vrai si l'authentification par principal de service (Entra ID) est sélectionnée. */
    protected readonly isServicePrincipal = computed<boolean>(() => this.isAzure() && this.authMode() === "service-principal");

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
        this.authMode.set("sql");
        this.clientId.set("");
        this.tenantId.set("");
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
                authMode: this.isAzure() ? this.authMode() : undefined,
                clientId: this.isServicePrincipal() ? this.clientId() : undefined,
                tenantId: this.isServicePrincipal() ? this.tenantId() : undefined,
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

