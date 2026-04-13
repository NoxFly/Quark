/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    HostListener,
    inject,
    OnDestroy,
    signal,
} from "@angular/core";

/**
 * Définition d'un item du menu contextuel.
 */
export interface ContextMenuItem {
    label: string;
    icon?: string;
    action: () => void;
    danger?: boolean;
    disabled?: boolean;
    separator?: boolean;
}

/**
 * Menu contextuel positionné au clic droit.
 */
@Component({
    selector: "app-context-menu",
    standalone: true,
    templateUrl: "./context-menu.component.html",
    styleUrl: "./context-menu.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContextMenuComponent implements OnDestroy {
    private readonly el = inject(ElementRef<HTMLElement>);

    protected readonly visible = signal<boolean>(false);
    protected readonly posX = signal<number>(0);
    protected readonly posY = signal<number>(0);
    protected readonly items = signal<ContextMenuItem[]>([]);

    /**
     * Ouvre le menu contextuel à la position donnée.
     */
    public open(event: MouseEvent, items: ContextMenuItem[]): void {
        event.preventDefault();
        event.stopPropagation();

        this.items.set(items);
        this.posX.set(event.clientX);
        this.posY.set(event.clientY);
        this.visible.set(true);

        // Ajuster la position si le menu déborde de la fenêtre
        requestAnimationFrame(() => {
            const menu = this.el.nativeElement.querySelector(".context-menu") as HTMLElement;
            if (!menu) {
                return;
            }

            const rect = menu.getBoundingClientRect();
            let x = this.posX();
            let y = this.posY();

            if (x + rect.width > window.innerWidth) {
                x = window.innerWidth - rect.width - 4;
            }

            if (y + rect.height > window.innerHeight) {
                y = window.innerHeight - rect.height - 4;
            }

            this.posX.set(x);
            this.posY.set(y);
        });
    }

    /**
     * Ferme le menu contextuel.
     */
    public close(): void {
        this.visible.set(false);
    }

    /**
     * Exécute l'action d'un item et ferme le menu.
     */
    protected onItemClick(item: ContextMenuItem): void {
        if (item.disabled || item.separator) {
            return;
        }

        item.action();
        this.close();
    }

    @HostListener("document:click")
    protected onDocumentClick(): void {
        if (this.visible()) {
            this.close();
        }
    }

    @HostListener("document:contextmenu")
    protected onDocumentContextMenu(): void {
        // Le composant parent gère le nouveau contextmenu
    }

    @HostListener("document:keydown.escape")
    protected onEscape(): void {
        if (this.visible()) {
            this.close();
        }
    }

    public ngOnDestroy(): void {
        this.close();
    }
}
