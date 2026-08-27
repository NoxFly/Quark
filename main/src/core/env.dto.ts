export enum AppEnv {
    DEVELOPMENT = "development",
    PRODUCTION = "production",
}

export enum OSType {
    Windows = "Windows",
    MacOS = "MacOS",
    Linux = "Linux",
}

export interface Environment {
    env: AppEnv;
    rootDir: string;
    publicDir: string;
    rendererDir: string;
    os: OSType;
    product: {
        name: string;
        displayName: string;
        version: string;
    };
    update: {
        /** Dépôt GitHub au format `owner/repo` qui héberge les releases. */
        repository: string;
        /** URL du manifeste de la dernière version publiée pour cette plateforme. */
        manifestUrl: string;
        /** Page des releases, ouverte quand la mise à jour ne peut être appliquée seule. */
        releasesUrl: string;
    };
}
