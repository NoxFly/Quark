import { Injectable, signal } from "@angular/core";
import { DatabaseSchema } from "@shared/types";

@Injectable({ providedIn: "root" })
export class StateService {
    public readonly connected = signal<boolean>(false);
    public readonly database = signal<DatabaseSchema | null>(null);
    public readonly filePath = signal<string | null>(null);
    public readonly needsPassword = signal<boolean>(false);
    public readonly pendingFilePath = signal<string | null>(null);
    public readonly title = signal<string>("SQLite Editor");
    public readonly appName = signal<string>("SQLite Editor");
    public readonly appVersion = signal<string>("");
    public readonly fileName = signal<string>("");
}
