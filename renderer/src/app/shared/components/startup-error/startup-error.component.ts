/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import { ChangeDetectionStrategy, Component, input, output, ViewEncapsulation } from "@angular/core";

/**
 * Écran affiché quand l'initialisation de l'application échoue.
 *
 * Il remplace l'écran de chargement, qui recouvre toute la fenêtre : sans lui,
 * un échec d'initialisation se traduit par une fenêtre entièrement blanche, sans
 * message ni moyen d'agir.
 */
@Component({
    selector: "app-startup-error",
    standalone: true,
    templateUrl: "./startup-error.component.html",
    styleUrl: "./startup-error.component.scss",
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StartupErrorComponent {
    /** Détail technique de l'échec, affiché tel quel pour le support. */
    public readonly details = input<string>("");

    /** Version de l'application, utile dans un rapport d'incident. */
    public readonly appVersion = input<string>("");

    /** Relance uniquement la séquence d'initialisation. */
    public readonly retry = output<void>();

    /** Recharge intégralement le document du renderer. */
    public readonly reload = output<void>();
}
