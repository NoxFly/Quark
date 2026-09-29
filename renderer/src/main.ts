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

import { enableProdMode } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { AppComponent } from "src/app/app.component";
import { config } from "src/app/core/app.config";
import { environment } from "src/environments/environment";


if (environment.production) {
    enableProdMode();
}

/**
 * Affiche un message minimal, sans Angular, quand le bootstrap lui-même échoue.
 *
 * `<app-root>` reste alors vide et la fenêtre est entièrement blanche : c'est le
 * seul niveau où l'on peut encore dire à l'utilisateur ce qui se passe.
 */
function renderBootstrapFailure(error: unknown): void {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);

    console.error("Angular bootstrap failed:", error);

    const container = document.createElement("div");
    container.setAttribute("style", [
        "position:fixed", "inset:0", "z-index:2000", "padding:40px",
        "display:flex", "flex-direction:column", "justify-content:center",
        "background:#fff", "color:#222",
        "font-family:system-ui,sans-serif", "font-size:13px",
    ].join(";"));

    const title = document.createElement("h1");
    title.textContent = "Quark could not start";
    title.setAttribute("style", "margin:0 0 12px;font-size:20px;color:#c0392b");

    const details = document.createElement("pre");
    details.textContent = message;
    details.setAttribute(
        "style",
        "max-height:240px;overflow:auto;padding:12px;border:1px solid #ddd;white-space:pre-wrap;word-break:break-word",
    );

    const reload = document.createElement("button");
    reload.textContent = "Reload the application";
    reload.setAttribute("style", "margin-top:24px;padding:8px 18px;align-self:flex-start;cursor:pointer");
    reload.addEventListener("click", () => {
        // Le pont Noxus n'est pas initialisé si Angular n'a pas démarré.
        window.location.reload();
    });

    container.append(title, details, reload);
    document.body.append(container);
}

try {
    await bootstrapApplication(AppComponent, config);
}
catch (error) {
    renderBootstrapFailure(error);
}
