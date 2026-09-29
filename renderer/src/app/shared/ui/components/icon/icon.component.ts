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

import { ChangeDetectionStrategy, Component, computed, input, OnInit, signal } from "@angular/core";
import { catchError, from, map, Observable, shareReplay, switchMap } from "rxjs";
import { SubscriptionManager } from "src/app/shared/directives/SubscriptionManager.directive";
import { BypassPipe } from "src/app/shared/pipes/bypass.pipe";

@Component({
    selector: "ui-icon",
    standalone: true,
    templateUrl: "./icon.component.html",
    styleUrls: ["./icon.component.scss"],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [BypassPipe],
})
export class IconComponent extends SubscriptionManager implements OnInit {
    public readonly src = input.required<string>();
    public readonly color = input<string>("");

    protected readonly content = signal<string>("");

    protected readonly isSVG = computed((): boolean => {
        return this.src().endsWith(".svg");
    });

    protected readonly isImage = computed((): boolean => {
        const img = this.src();
        return img.endsWith(".png") || img.endsWith(".jpg") || img.endsWith(".jpeg") || img.startsWith("data:image/");
    });

    /**
     *
     */
    protected getUnicode(icon: string): string {
        return `&#x${icon};`;
    }

    /**
     *
     */
    private async fetchInlineSVG(): Promise<void> {
        if (IconBank.has(this.src())) {
            const c = IconBank.get(this.src());
            this.content.set(c);
            return;
        }

        try {
            this.watch$ = IconBank.load(this.src()).pipe(
                map((content) => {
                    this.content.set(content);
                }),
            );
        } catch (error) {
            console.error("File not found:", this.src(), error);
        }
    }

    /**
     *
     */
    public ngOnInit(): void {
        if (this.isSVG()) {
            this.fetchInlineSVG();
        }
    }
}

class IconBank {
    private static readonly icons = new Map<string, string>();
    public static loadingIcons: Map<string, Observable<string>> = new Map<string, Observable<string>>();

    /**
     *
     */
    public static get(path: string): string {
        if (IconBank.icons.has(path)) {
            return IconBank.icons.get(path)!;
        }

        return "";
    }

    /**
     *
     */
    public static set(path: string, content: string): void {
        IconBank.icons.set(path, content);
    }

    /**
     *
     */
    public static has(path: string): boolean {
        return IconBank.icons.has(path);
    }

    /**
     *
     */
    public static load(path: string): Observable<string> {
        // another caller has initiated the loading of this icon
        if (IconBank.loadingIcons.has(path)) {
            return IconBank.loadingIcons.get(path) as Observable<string>;
        }

        // no other caller has initiated the loading of this icon
        const obs = from(fetch(path)).pipe(
            map((response) => {
                if (response.ok) {
                    return response;
                }

                throw new Error(`Failed to load icon: ${path} (status: ${response.status})`);
            }),
            switchMap((response) => response.text()),
            map((svgStr) => {
                const parser = new DOMParser();
                const svgDoc = parser.parseFromString(svgStr, "image/svg+xml");

                const svg = svgDoc.querySelector("svg");

                if (svg) {
                    svg.removeAttribute("width");
                    svg.removeAttribute("height");
                }

                svgDoc.documentElement.style.verticalAlign = "top";

                const content = svgDoc.documentElement.outerHTML;

                IconBank.set(path, content);

                IconBank.loadingIcons.delete(path);

                return content;
            }),
            catchError((error) => {
                console.warn("Error loading icon:", path, error);
                IconBank.loadingIcons.delete(path);
                throw error;
            }),
            shareReplay(1),
        );
        // Store the observable so other callers can subscribe to the same fetch
        IconBank.loadingIcons.set(path, obs);

        return obs;
    }
}
