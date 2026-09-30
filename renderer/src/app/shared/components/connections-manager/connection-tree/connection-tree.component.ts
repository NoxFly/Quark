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

import { ChangeDetectionStrategy, Component, input, output, signal } from "@angular/core";
import type { ConnectionProfile, ConnectionTagDef } from "@shared/connection";
import type { ConnectionFolderNode, ConnectionProfileMove } from "src/app/core/models/connections.model";
import { profileDotColor } from "src/app/shared/helpers/connections.helper";
import { DriverThumbComponent } from "src/app/shared/components/connections-manager/driver-thumb/driver-thumb.component";

/** Emplacement visé pendant un glisser-déposer : position parmi les autres profils du dossier. */
interface DropTarget {
    folderId: string;
    index: number;
}

/** Clic droit sur un profil, pour son menu contextuel. */
export interface ProfileContextMenuEvent {
    event: MouseEvent;
    profile: ConnectionProfile;
}

/**
 * Arbre dossiers → profils du gestionnaire de connexions. Purement présentatif :
 * la sélection, l'état replié et l'ordre appartiennent au parent, qui reçoit les
 * déplacements par `profileMoved`.
 *
 * Les profils se réordonnent par glisser-déposer, dans leur dossier ou vers un
 * autre : une barre horizontale montre où le profil sera déposé.
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
    /** Étiquettes du coffre, pour la couleur des pastilles. */
    public readonly tags = input<ConnectionTagDef[]>([]);

    public readonly profileSelected = output<ConnectionProfile>();
    public readonly profileOpened = output<ConnectionProfile>();
    public readonly folderSelected = output<ConnectionFolderNode>();
    public readonly folderToggled = output<string>();
    public readonly profileMoved = output<ConnectionProfileMove>();
    public readonly profileContextMenu = output<ProfileContextMenuEvent>();

    /** Profil en cours de glissement. */
    protected readonly draggedId = signal<string | null>(null);
    protected readonly dropTarget = signal<DropTarget | null>(null);

    protected dotColor(profile: ConnectionProfile): string {
        return profileDotColor(profile, this.tags());
    }

    /**
     * Affiche la barre de dépôt juste avant ce profil. Le profil glissé n'en porte
     * jamais : la barre irait au même endroit qu'avant le profil suivant.
     */
    protected isLineBefore(folder: ConnectionFolderNode, profile: ConnectionProfile): boolean {
        const target = this.dropTarget();

        if (!target || target.folderId !== folder.id || profile.id === this.draggedId()) {
            return false;
        }

        return this.others(folder).indexOf(profile) === target.index;
    }

    /**
     * Affiche la barre de dépôt en fin de dossier.
     */
    protected isLineAtEnd(folder: ConnectionFolderNode): boolean {
        const target = this.dropTarget();
        return target !== null && target.folderId === folder.id && target.index === this.others(folder).length;
    }

    protected onDragStart(event: DragEvent, profile: ConnectionProfile): void {
        this.draggedId.set(profile.id);

        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", profile.id);
        }
    }

    /**
     * Survol d'un profil : la moitié haute vise la place avant lui, la moitié basse
     * celle d'après.
     */
    protected onProfileDragOver(event: DragEvent, folder: ConnectionFolderNode, profile: ConnectionProfile): void {
        if (!this.acceptDrag(event) || folder.virtual) {
            return;
        }

        const others = this.others(folder);
        const row = event.currentTarget as HTMLElement;
        const { top, height } = row.getBoundingClientRect();
        const after = event.clientY - top > height / 2;

        // Survoler le profil glissé vise sa place actuelle : autant d'autres profils
        // avant lui que dans le dossier.
        const index = profile.id === this.draggedId()
            ? folder.profiles.indexOf(profile)
            : others.indexOf(profile) + (after ? 1 : 0);

        this.dropTarget.set({ folderId: folder.id, index });
    }

    /**
     * Survol d'un dossier : un dossier ouvert reçoit le profil en tête, un dossier
     * replié à la fin (ses profils n'étant pas visibles pour viser mieux).
     */
    protected onFolderDragOver(event: DragEvent, folder: ConnectionFolderNode, open: boolean): void {
        if (!this.acceptDrag(event) || folder.virtual) {
            return;
        }

        this.dropTarget.set({ folderId: folder.id, index: open ? 0 : this.others(folder).length });
    }

    protected onDrop(event: DragEvent): void {
        event.preventDefault();

        const id = this.draggedId();
        const target = this.dropTarget();

        if (id && target) {
            this.profileMoved.emit({ id, folderId: target.folderId, index: target.index });
        }

        this.onDragEnd();
    }

    protected onDragEnd(): void {
        this.draggedId.set(null);
        this.dropTarget.set(null);
    }

    protected onContextMenu(event: MouseEvent, profile: ConnectionProfile): void {
        event.preventDefault();
        this.profileContextMenu.emit({ event, profile });
    }

    /**
     * Profils du dossier hors profil glissé : l'index de dépôt s'y rapporte, comme
     * celui qu'attend le main.
     */
    private others(folder: ConnectionFolderNode): ConnectionProfile[] {
        const dragged = this.draggedId();
        return folder.profiles.filter(profile => profile.id !== dragged);
    }

    /**
     * Autorise le dépôt pendant le glissement d'un profil de cet arbre (et pas d'un
     * fichier déposé depuis l'explorateur).
     */
    private acceptDrag(event: DragEvent): boolean {
        if (!this.draggedId()) {
            return false;
        }

        event.preventDefault();

        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "move";
        }

        return true;
    }

    /**
     * Replie / déplie un dossier sans le sélectionner.
     */
    protected toggle(event: Event, folder: ConnectionFolderNode): void {
        event.stopPropagation();
        this.folderToggled.emit(folder.id);
    }
}
