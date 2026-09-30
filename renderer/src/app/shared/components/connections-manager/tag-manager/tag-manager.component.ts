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

import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import type { ConnectionTagDef, ConnectionTagInput } from "@shared/connection";
import { ConnectionsService } from "src/app/core/services/connections.service";
import { I18nService } from "src/app/core/services/i18n.service";
import { isBuiltinTagId, TAG_PALETTE, tagColor, tagLabel } from "src/app/shared/helpers/connections.helper";
import { extractIpcErrorMessage } from "src/app/shared/helpers/utils";
import { TranslatePipe } from "src/app/shared/pipes/translate.pipe";
import { AlertController } from "@ui/alert/alert.controller";
import { ToastController } from "@ui/toast/toast.controller";

/**
 * Gestion des étiquettes du coffre, posée par-dessus le gestionnaire : création,
 * renommage, choix de la couleur dans une palette et suppression, étiquettes
 * fournies comprises. Chaque modification est enregistrée aussitôt.
 */
@Component({
    selector: "app-tag-manager",
    standalone: true,
    templateUrl: "./tag-manager.component.html",
    styleUrl: "./tag-manager.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, TranslatePipe],
})
export class TagManagerComponent {
    private readonly connections = inject(ConnectionsService);
    private readonly i18n = inject(I18nService);
    private readonly alertCtrl = inject(AlertController);
    private readonly toastCtrl = inject(ToastController);

    public readonly closed = output<void>();

    protected readonly palette = TAG_PALETTE;
    protected readonly tags = this.connections.tags;
    protected readonly tagColor = tagColor;
    protected readonly isBuiltin = isBuiltinTagId;

    /** Étiquette dont la palette est dépliée (`"new"` : celle de la création). */
    protected readonly paletteFor = signal<string | null>(null);
    protected readonly newName = signal<string>("");
    protected readonly newColor = signal<string>(TAG_PALETTE[0] ?? "#0091ff");
    protected readonly busy = signal<boolean>(false);

    protected readonly canCreate = computed<boolean>(() => this.newName().trim().length > 0 && !this.busy());

    /**
     * Nom traduit d'une étiquette fournie, affiché en indication quand son nom
     * n'est pas personnalisé.
     */
    protected defaultName(tag: ConnectionTagDef): string {
        return tagLabel({ ...tag, name: undefined }, key => this.i18n.t(key));
    }

    protected togglePalette(id: string): void {
        this.paletteFor.update(current => (current === id ? null : id));
    }

    /**
     * Renomme une étiquette à la sortie du champ. Un nom vidé rend à une étiquette
     * fournie son nom traduit ; celui d'une étiquette créée est rétabli.
     */
    protected async rename(tag: ConnectionTagDef, value: string): Promise<void> {
        const name = value.trim();

        if (name === (tag.name ?? "") || (!name && !isBuiltinTagId(tag.id))) {
            return;
        }

        await this.run(() => this.connections.updateTag(tag.id, { name }));
    }

    /**
     * Applique une couleur ; `""` rend à une étiquette fournie celle du thème.
     */
    protected async recolor(tag: ConnectionTagDef, color: string): Promise<void> {
        this.paletteFor.set(null);
        await this.run(() => this.connections.updateTag(tag.id, { color } satisfies ConnectionTagInput));
    }

    protected pickNewColor(color: string): void {
        this.newColor.set(color);
        this.paletteFor.set(null);
    }

    protected async create(): Promise<void> {
        if (!this.canCreate()) {
            return;
        }

        const input: ConnectionTagInput = { name: this.newName().trim(), color: this.newColor() };

        await this.run(async () => {
            await this.connections.createTag(input);
            this.newName.set("");
        });
    }

    /**
     * Supprime une étiquette après confirmation, en précisant combien de connexions
     * la perdront.
     */
    protected async remove(tag: ConnectionTagDef): Promise<void> {
        const count = this.connections.profiles().filter(profile => profile.tag === tag.id).length;
        const name = tagLabel(tag, key => this.i18n.t(key));

        await this.alertCtrl.create({
            title: this.i18n.t("connections.tags.deleteTitle", { name }),
            message: count > 0
                ? this.i18n.t("connections.tags.deleteUsed", { count })
                : this.i18n.t("connections.tags.deleteUnused"),
            color: "danger",
            actions: [
                { text: this.i18n.t("editor.cancel"), role: "cancel" },
                {
                    text: this.i18n.t("connections.delete"),
                    role: "destructive",
                    color: "danger",
                    handler: self => {
                        self.dismiss({ role: "destructive" });
                        void this.run(() => this.connections.deleteTag(tag.id));
                    },
                },
            ],
        });
    }

    private async run(action: () => Promise<void>): Promise<void> {
        this.busy.set(true);

        try {
            await action();
        }
        catch (err) {
            await this.toastCtrl.create({ message: extractIpcErrorMessage(err), duration: 4000, color: "danger" });
        }
        finally {
            this.busy.set(false);
        }
    }
}
