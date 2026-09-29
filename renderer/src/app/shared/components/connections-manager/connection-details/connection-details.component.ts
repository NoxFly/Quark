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

import { ChangeDetectionStrategy, Component, computed, inject, input, output } from "@angular/core";
import type { ConnectionProfile } from "@shared/connection";
import type { ConnectionAddress } from "src/app/core/models/connections.model";
import { I18nService } from "src/app/core/services/i18n.service";
import {
    formatLastConnected,
    profileAddress,
    profileDatabaseName,
    profileDotColor,
    tagLabelKey,
} from "src/app/shared/helpers/connections.helper";
import { TranslatePipe } from "src/app/shared/pipes/translate.pipe";
import { DriverThumbComponent } from "src/app/shared/components/connections-manager/driver-thumb/driver-thumb.component";

/**
 * Fiche en lecture seule d'un profil de connexion, avec les actions du pied
 * (import / export chiffré, suppression, modification, connexion).
 */
@Component({
    selector: "app-connection-details",
    standalone: true,
    templateUrl: "./connection-details.component.html",
    styleUrl: "./connection-details.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [TranslatePipe, DriverThumbComponent],
})
export class ConnectionDetailsComponent {
    private readonly i18n = inject(I18nService);

    public readonly profile = input.required<ConnectionProfile>();
    /** Nom du dossier de rangement. */
    public readonly folderName = input<string>("");
    /** Nom affiché du driver. */
    public readonly typeLabel = input<string>("");
    public readonly busy = input<boolean>(false);

    public readonly importRequested = output<void>();
    public readonly exportRequested = output<void>();
    public readonly deleteRequested = output<void>();
    public readonly editRequested = output<void>();
    public readonly connectRequested = output<void>();

    protected readonly address = computed<ConnectionAddress>(() => profileAddress(this.profile()));
    protected readonly databaseName = computed<string>(() => profileDatabaseName(this.profile()) || "—");
    protected readonly dotColor = computed<string>(() => profileDotColor(this.profile()));
    protected readonly tagKey = computed<string>(() => tagLabelKey(this.profile().tag));
    protected readonly isServicePrincipal = computed<boolean>(() => this.profile().authMode === "service-principal");
    protected readonly notes = computed<string>(() => this.profile().notes?.trim() || "—");

    protected readonly lastConnected = computed<string>(() => {
        const labels = {
            today: this.i18n.t("connections.lastConnected.today"),
            yesterday: this.i18n.t("connections.lastConnected.yesterday"),
            never: this.i18n.t("connections.lastConnected.never"),
        };

        return formatLastConnected(this.profile().lastConnectedAt, new Date(), this.i18n.locale(), labels);
    });
}
