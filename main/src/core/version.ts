/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

/**
 * `major.minor.patch` suivi d'un métatag optionnel (`+build.42`, `-beta.7`).
 * Le métatag porte le numéro de build produit par la CI.
 */
const VERSION_REGEX = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:(?<separator>[+-])(?<metatag>\w+)(?:\.(?<build>\d+))?)?/;

/**
 * Version applicative comparable.
 *
 * Le format publié est `major.minor.patch[+build.<n>|-<canal>.<n>]` : deux
 * publications successives peuvent partager `major.minor.patch` et ne différer
 * que par le numéro de build, d'où la comparaison en dernier ressort sur ce
 * dernier fragment.
 */
export class Version {
    public readonly major: number;
    public readonly minor: number;
    public readonly patch: number;
    public readonly build: number | null;
    public readonly metatag: string | null;
    public readonly isPreRelease: boolean;

    /**
     * @param version - Chaîne de version à analyser.
     * @throws Error si la chaîne ne respecte pas le format attendu.
     * @example
     * new Version("1.4.2+build.318").compareTo(new Version("1.4.2+build.317")); // 1
     */
    public constructor(version: string) {
        const match = VERSION_REGEX.exec(version.trim());

        if (!match?.groups) {
            throw new Error(`Invalid version string: ${version}`);
        }

        const { major, minor, patch, separator, metatag, build } = match.groups;

        this.major = Number.parseInt(major ?? "0", 10);
        this.minor = Number.parseInt(minor ?? "0", 10);
        this.patch = Number.parseInt(patch ?? "0", 10);
        this.isPreRelease = separator === "-";
        this.metatag = metatag ?? null;
        this.build = build === undefined ? null : Number.parseInt(build, 10);
    }

    /**
     * Analyse une version sans lever d'exception.
     * @param version - Chaîne de version à analyser.
     * @returns La version, ou `null` si la chaîne est invalide.
     */
    public static parse(version: string): Version | null {
        try {
            return new Version(version);
        }
        catch {
            return null;
        }
    }

    /**
     * Compare deux versions.
     * @param other - Version à comparer.
     * @returns Un nombre négatif si `this` est antérieure, `0` si identiques,
     *          positif si `this` est postérieure.
     */
    public compareTo(other: Version): number {
        if (this.major !== other.major) {
            return this.major - other.major;
        }

        if (this.minor !== other.minor) {
            return this.minor - other.minor;
        }

        if (this.patch !== other.patch) {
            return this.patch - other.patch;
        }

        // Une préversion précède toujours la version stable de même numéro.
        if (this.isPreRelease !== other.isPreRelease) {
            return this.isPreRelease ? -1 : 1;
        }

        const thisBuild = this.build ?? 0;
        const otherBuild = other.build ?? 0;

        return thisBuild - otherBuild;
    }

    /**
     * Reconstruit la chaîne de version d'origine.
     */
    public toString(): string {
        let version = `${this.major}.${this.minor}.${this.patch}`;

        if (this.metatag !== null) {
            version += `${this.isPreRelease ? "-" : "+"}${this.metatag}`;
        }

        if (this.build !== null) {
            version += `.${this.build}`;
        }

        return version;
    }
}
