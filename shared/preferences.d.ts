export interface Preferences {
    id: number;
    isPrefered: boolean;
    theme: Theme;
}

export type Theme = "light" | "dark" | "midnight" | "system";
