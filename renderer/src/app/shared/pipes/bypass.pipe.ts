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
