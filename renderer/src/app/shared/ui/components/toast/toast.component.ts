/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import { ChangeDetectionStrategy, Component, computed, input, model, OnInit } from "@angular/core";
import { UIComponent } from "src/app/shared/ui/UIComponent.directive";
import type { ToastPosition, UIAction, UIColor } from "src/app/shared/ui/ui.types";

@Component({
    selector: "ui-toast",
    standalone: true,
    templateUrl: "./toast.component.html",
    styleUrls: ["./toast.component.scss"],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        "[attr.data-toast-type]": "color() || 'medium'",
        "[attr.data-toast-position]": "position() || 'top-center'",
    }
})
export class ToastComponent extends UIComponent implements OnInit {
    public readonly message = model.required<string>();
    public readonly duration = input<number>();
    public readonly color = input<UIColor>();
    public readonly closable = input<boolean>();
    public readonly position = input<ToastPosition>();
    public readonly actions = input<UIAction[]>([]);

    protected readonly hasActions = computed(() => this.actions().length > 0);
    protected readonly hasDuration = computed(() => this.duration() !== undefined);

    /**
     *
     */
    protected close(): void {
        this.dismiss();
    }

    /**
     *
     */
    public ngOnInit(): void {
        if (this.hasDuration()) {
            this.ref.nativeElement.style.setProperty("--toast-duration", `${this.duration()}ms`);
            this.ref.nativeElement.classList.add("ephemeral");

            this.ref.nativeElement.addEventListener(
                "animationend",
                () => {
                    this.dismiss();
                },
                { once: true },
            );
        }
    }
}
