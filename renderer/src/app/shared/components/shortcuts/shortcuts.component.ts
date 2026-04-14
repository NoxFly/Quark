/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { I18nService } from "src/app/core/services/i18n.service";
import { ButtonComponent } from "@ui/button/button.component";

/** Définition d'un raccourci clavier. */
interface ShortcutEntry {
    keys: string;
    description: string;
}

/** Groupe de raccourcis. */
interface ShortcutGroup {
    title: string;
    shortcuts: ShortcutEntry[];
}

/**
 * Modal affichant l'ensemble des raccourcis clavier de l'application.
 */
@Component({
    selector: "app-shortcuts",
    standalone: true,
    templateUrl: "./shortcuts.component.html",
    styleUrl: "./shortcuts.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ButtonComponent],
})
export class ShortcutsComponent {
    protected readonly i18n = inject(I18nService);

    /** Callback de fermeture. */
    public dismiss?: () => void;

    /** Groupes de raccourcis clavier. */
    protected readonly groups = signal<ShortcutGroup[]>([
        {
            title: "shortcuts.group.file",
            shortcuts: [
                { keys: "Ctrl+O", description: "shortcuts.open" },
                { keys: "Ctrl+Shift+N", description: "shortcuts.newWindow" },
                { keys: "Ctrl+K  Ctrl+F", description: "shortcuts.closeFile" },
                { keys: "Ctrl+Shift+R", description: "shortcuts.refreshDb" },
                { keys: "Ctrl+R", description: "shortcuts.recentDb" },
                { keys: "Ctrl+Alt+R", description: "shortcuts.reload" },
                { keys: "Alt+F4", description: "shortcuts.quit" },
            ],
        },
        {
            title: "shortcuts.group.edit",
            shortcuts: [
                { keys: "Ctrl+E", description: "shortcuts.toggleEditMode" },
                { keys: "Ctrl+T", description: "shortcuts.startTransaction" },
                { keys: "Ctrl+Z", description: "shortcuts.undo" },
                { keys: "Ctrl+Y", description: "shortcuts.redo" },
            ],
        },
        {
            title: "shortcuts.group.view",
            shortcuts: [
                { keys: "Ctrl+Shift+Q", description: "shortcuts.sqlEditor" },
                { keys: "F11", description: "shortcuts.fullscreen" },
                { keys: "Ctrl+K  Ctrl+T", description: "shortcuts.changeTheme" },
            ],
        },
        {
            title: "shortcuts.group.tabs",
            shortcuts: [
                { keys: "Ctrl+W", description: "shortcuts.closeTab" },
            ],
        },
        {
            title: "shortcuts.group.sqlEditor",
            shortcuts: [
                { keys: "Ctrl+Enter", description: "shortcuts.executeSql" },
                { keys: "Ctrl+↑ / Ctrl+↓", description: "shortcuts.sqlHistory" },
            ],
        },
    ]);

    protected close(): void {
        this.dismiss?.();
    }
}
