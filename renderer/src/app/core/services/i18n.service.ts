/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import { Injectable, signal } from "@angular/core";
import { en } from "src/app/core/i18n/en";
import { fr } from "src/app/core/i18n/fr";

/**
 * Locales supportées par l'application.
 */
export type SupportedLocale = "en" | "fr";

const LOCALE_STORAGE_KEY = "sqlite-editor-locale";

const translations: Record<SupportedLocale, Record<string, string>> = { en, fr };

/**
 * Service d'internationalisation basé sur des signaux.
 * Gère la locale courante, les traductions, et le formatage localisé (nombres, dates, devises).
 */
@Injectable({ providedIn: "root" })
export class I18nService {
    /**
     * Locale courante. La lecture de ce signal dans un `computed()` permet
     * une ré-évaluation automatique à chaque changement de langue.
     */
    public readonly locale = signal<SupportedLocale>(this.loadLocale());

    /**
     * Signal interne contenant le dictionnaire de traductions actif.
     */
    private readonly currentTranslations = signal<Record<string, string>>(
        translations[this.loadLocale()]
    );

    /**
     * Liste des locales disponibles.
     */
    public readonly availableLocales: readonly SupportedLocale[] = ["en", "fr"];

    /**
     * Labels pour les locales dans leur propre langue.
     */
    public readonly localeLabels: Record<SupportedLocale, string> = {
        en: "English",
        fr: "Français",
    };

    /**
     * Change la locale courante et persiste le choix.
     */
    public setLocale(locale: SupportedLocale): void {
        if (!translations[locale]) {
            return;
        }

        this.locale.set(locale);
        this.currentTranslations.set(translations[locale]);

        try {
            localStorage.setItem(LOCALE_STORAGE_KEY, locale);
        }
        catch {
            // Ignore si localStorage n'est pas disponible
        }
    }

    /**
     * Traduit une clé avec remplacement optionnel de paramètres.
     * Lire le signal `currentTranslations` rend cette méthode réactive
     * quand elle est appelée dans un `computed()` ou un template.
     *
     * @param key - Clé de traduction (ex: "menu.file")
     * @param params - Paramètres à substituer (ex: { count: 5 })
     * @returns La chaîne traduite, ou la clé si non trouvée
     *
     * @example
     * i18n.t("statusbar.rows", { loaded: 10, total: 100 })
     * // → "10 / 100 rows"
     */
    public t(key: string, params?: Record<string, string | number>): string {
        let value = this.currentTranslations()[key] ?? key;

        if (params) {
            for (const [paramKey, paramValue] of Object.entries(params)) {
                value = value.replace(new RegExp(`\\{${paramKey}\\}`, "g"), String(paramValue));
            }
        }

        return value;
    }

    /**
     * Formate un nombre selon la locale courante.
     */
    public formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
        return new Intl.NumberFormat(this.locale(), options).format(value);
    }

    /**
     * Formate une devise selon la locale courante.
     */
    public formatCurrency(value: number, currency = "EUR"): string {
        return new Intl.NumberFormat(this.locale(), {
            style: "currency",
            currency,
        }).format(value);
    }

    /**
     * Formate une date selon la locale courante.
     */
    public formatDate(value: Date | string | number, options?: Intl.DateTimeFormatOptions): string {
        const date = value instanceof Date ? value : new Date(value);
        return new Intl.DateTimeFormat(this.locale(), options).format(date);
    }

    /**
     * Charge la locale depuis le localStorage ou utilise la langue du navigateur.
     */
    private loadLocale(): SupportedLocale {
        try {
            const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
            if (stored && stored in translations) {
                return stored as SupportedLocale;
            }
        }
        catch {
            // Ignore
        }

        // Détecter la langue du navigateur
        const browserLang = navigator.language.split("-")[0] ?? "";
        if (browserLang in translations) {
            return browserLang as SupportedLocale;
        }

        return "en";
    }
}
