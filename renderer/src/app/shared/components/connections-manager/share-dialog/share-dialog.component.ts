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

import { ChangeDetectionStrategy, Component, computed, inject, input, type OnInit, output, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import type { ConnectionProfile } from "@shared/connection";
import type { R_ShareCreateBody, ShareExpiryHours } from "@shared/share";
import { I18nService } from "src/app/core/services/i18n.service";
import { NoxusService } from "src/app/core/services/noxus.service";
import { extractIpcErrorMessage } from "src/app/shared/helpers/utils";
import { TranslatePipe } from "src/app/shared/pipes/translate.pipe";
import { SelectOptionComponent } from "@ui/select/select-option/select-option.component";
import { SelectComponent } from "@ui/select/select.component";
import { SwitchComponent } from "@ui/switch/switch.component";
import { ToastController } from "@ui/toast/toast.controller";

/** Longueur minimale du mot de passe de partage (vérifiée aussi par le main). */
const MIN_SHARE_PASSWORD_LENGTH = 3;

/**
 * Durées de validité proposées, en heures ; `"0"` : sans limite. En texte : la
 * liste déroulante ne compare que des valeurs texte.
 */
const EXPIRY_CHOICES: readonly string[] = ["0", "1", "4", "8", "24", "48", "168"];

/**
 * Création d'un fichier de partage pour un profil distant.
 *
 * Les identifiants du profil sont repris par défaut ; l'utilisateur peut en
 * saisir d'autres pour ce seul fichier (un compte en lecture seule, par
 * exemple), sans toucher au profil. Le fichier est chiffré par un mot de passe
 * de partage, à transmettre au destinataire par un autre canal.
 */
@Component({
    selector: "app-share-dialog",
    standalone: true,
    templateUrl: "./share-dialog.component.html",
    styleUrl: "./share-dialog.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, TranslatePipe, SelectComponent, SelectOptionComponent, SwitchComponent],
})
export class ShareDialogComponent implements OnInit {
    private readonly noxus = inject(NoxusService);
    private readonly i18n = inject(I18nService);
    private readonly toastCtrl = inject(ToastController);

    public readonly profile = input.required<ConnectionProfile>();
    public readonly closed = output<void>();

    protected readonly expiryChoices = EXPIRY_CHOICES;
    protected readonly minPasswordLength = MIN_SHARE_PASSWORD_LENGTH;

    protected readonly name = signal<string>("");
    protected readonly username = signal<string>("");
    protected readonly secret = signal<string>("");
    protected readonly password = signal<string>("");
    /** Secret enregistré du profil, repris dans le champ à l'ouverture. */
    private storedSecret = "";
    protected readonly readOnly = signal<boolean>(true);
    protected readonly singleUse = signal<boolean>(false);
    protected readonly expiry = signal<string>("24");
    protected readonly busy = signal<boolean>(false);
    protected readonly error = signal<string | null>(null);

    /** Le profil se connecte avec un utilisateur modifiable (pas d'URI MongoDB, de jeton ni de principal de service). */
    protected readonly hasUsername = computed<boolean>(() => {
        const profile = this.profile();
        return profile.driverType !== "mongodb" && profile.driverType !== "libsql" && profile.authMode !== "service-principal";
    });

    /** Libellé du secret selon ce qu'il est pour ce driver. */
    protected readonly secretLabelKey = computed<string>(() => {
        const profile = this.profile();

        if (profile.driverType === "libsql") {
            return "share.create.token";
        }

        return profile.authMode === "service-principal" ? "connections.form.clientSecret" : "share.create.dbPassword";
    });

    protected readonly canSubmit = computed<boolean>(() =>
        this.name().trim().length > 0
        && this.password().length >= MIN_SHARE_PASSWORD_LENGTH
        && !this.busy(),
    );

    public ngOnInit(): void {
        this.name.set(this.profile().name);
        this.username.set(this.profile().username ?? "");
        void this.loadStoredSecret();
    }

    /**
     * Préremplit le secret de la base avec celui du profil, s'il en a un.
     */
    private async loadStoredSecret(): Promise<void> {
        if (!this.profile().hasPassword) {
            return;
        }

        try {
            this.storedSecret = await this.noxus.ipc.shareProfileSecret(this.profile().id);

            // Une saisie commencée entre-temps n'est pas écrasée.
            if (!this.secret()) {
                this.secret.set(this.storedSecret);
            }
        }
        catch {
            // Sans secret prérempli, celui du profil reste utilisé si le champ reste vide.
        }
    }

    protected expiryLabel(hours: string): string {
        return this.i18n.t(`share.create.expiry.${hours}`);
    }

    /**
     * Chiffre le partage et demande où l'enregistrer.
     */
    protected async submit(): Promise<void> {
        if (!this.canSubmit()) {
            return;
        }

        const profile = this.profile();
        const username = this.username().trim();
        const body: R_ShareCreateBody = {
            profileId: profile.id,
            name: this.name().trim(),
            password: this.password(),
            readOnly: this.readOnly(),
            singleUse: this.singleUse(),
            expiresInHours: this.expiry() === "0" ? null : Number(this.expiry()) as ShareExpiryHours,
            // Champs laissés tels quels : ceux du profil sont utilisés.
            username: this.hasUsername() && username !== (profile.username ?? "") ? username : undefined,
            // Le secret du profil, prérempli ou laissé vide, n'est pas renvoyé.
            secret: this.secret() && this.secret() !== this.storedSecret ? this.secret() : undefined,
        };

        this.busy.set(true);
        this.error.set(null);

        try {
            const written = await this.noxus.ipc.shareCreate(body);

            if (written) {
                await this.toastCtrl.create({ message: this.i18n.t("share.create.done"), duration: 4000, color: "success" });
                this.closed.emit();
            }
        }
        catch (err) {
            this.error.set(extractIpcErrorMessage(err));
        }
        finally {
            this.busy.set(false);
        }
    }
}
