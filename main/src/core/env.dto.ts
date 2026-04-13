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
}
