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

import { Pipe, PipeTransform } from "@angular/core";
import { DomSanitizer, SafeHtml, SafeResourceUrl, SafeScript, SafeStyle, SafeUrl } from "@angular/platform-browser";

// http://szumiato.pl/2017/03/23/angular-2-sanitizer-debounce/

/**
 * Ce pipe **désactive** la protection XSS d'Angular pour le type demandé.
 * Il NE sanitize PAS le contenu : il le marque comme "de confiance" via `bypassSecurityTrust*`.
 *
 * ⚠️  ATTENTION : Ne jamais utiliser ce pipe avec des données provenant d'une source
 * non fiable (saisie utilisateur, API externe non maîtrisée). Le contenu passé
 * sera inséré tel quel dans le DOM, ce qui peut provoquer des attaques XSS.
 *
 * Utilisation légitime : contenu généré en interne (HTML construit côté code,
 * styles dynamiques calculés, URLs internes connues).
 *
 * Exemple :
 * ```html
 * <div [innerHTML]="trustedHtml | bypass:'html'"></div>
 * ```
 */
@Pipe({ name: "bypass", standalone: true })
export class BypassPipe implements PipeTransform {
    public constructor(private readonly sanitizer: DomSanitizer) {}

    /**
     * @description
     * Transforme la valeur en un objet sécurisé en fonction du type spécifié.
     */
    public transform(value: string, type: string): SafeHtml | SafeStyle | SafeScript | SafeUrl | SafeResourceUrl {
        switch (type) {
            case "html":
                return this.sanitizer.bypassSecurityTrustHtml(value);
            case "style":
                return this.sanitizer.bypassSecurityTrustStyle(value);
            case "script":
                return this.sanitizer.bypassSecurityTrustScript(value);
            case "url":
                return this.sanitizer.bypassSecurityTrustUrl(value);
            case "resourceUrl":
                return this.sanitizer.bypassSecurityTrustResourceUrl(value);
            default:
                throw new Error(`Unable to bypass security for invalid type: ${type}`);
        }
    }
}
