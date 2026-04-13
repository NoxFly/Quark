import { Injectable, signal } from "@angular/core";
import { DatabaseSchema } from "@shared/types";

@Injectable({ providedIn: "root" })
export class StateService {
    public connected = signal<boolean>(false);
    public database = signal<DatabaseSchema | null>(null);
}
