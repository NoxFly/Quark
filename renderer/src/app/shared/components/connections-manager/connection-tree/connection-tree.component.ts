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

import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import type { ConnectionProfile } from "@shared/connection";
import type { ConnectionFolderNode } from "src/app/core/models/connections.model";
import { profileDotColor } from "src/app/shared/helpers/connections.helper";
import { DriverThumbComponent } from "src/app/shared/components/connections-manager/driver-thumb/driver-thumb.component";

/**
 * Arbre dossiers → profils du gestionnaire de connexions. Purement présentatif :
 * la sélection et l'état replié appartiennent au parent.
 */
@Component({
    selector: "app-connection-tree",
    standalone: true,
    templateUrl: "./connection-tree.component.html",
    styleUrl: "./connection-tree.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DriverThumbComponent],
})
export class ConnectionTreeComponent {
    public readonly tree = input<ConnectionFolderNode[]>([]);
    public readonly collapsed = input<ReadonlySet<string>>(new Set());
    public readonly selectedProfileId = input<string | null>(null);
    public readonly selectedFolderId = input<string | null>(null);

    public readonly profileSelected = output<ConnectionProfile>();
    public readonly profileOpened = output<ConnectionProfile>();
    public readonly folderSelected = output<ConnectionFolderNode>();
    public readonly folderToggled = output<string>();

    protected readonly dotColor = profileDotColor;

    /**
     * Replie / déplie un dossier sans le sélectionner.
     */
    protected toggle(event: Event, folder: ConnectionFolderNode): void {
        event.stopPropagation();
        this.folderToggled.emit(folder.id);
    }
}
