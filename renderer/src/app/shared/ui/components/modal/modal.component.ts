/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import {
    AfterViewInit,
    ChangeDetectionStrategy,
    Component,
    input,
    OnDestroy,
    OnInit,
    Type,
    viewChild,
    ViewContainerRef,
    ViewEncapsulation
} from "@angular/core";
import { UIComponent } from "src/app/shared/ui/UIComponent.directive";

@Component({
    selector: "ui-modal",
    standalone: true,
    templateUrl: "./modal.component.html",
    styleUrl: "./modal.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    encapsulation: ViewEncapsulation.None,
    host: {
        "[class.show-dots]": "showDots()",
        "[class.blurry]": "blurry()",
        "[class.animated]": "animated()",
    }
})
export class ModalComponent extends UIComponent implements OnInit, OnDestroy, AfterViewInit {
    public readonly component = input.required<Type<new () => any>>();
    public readonly componentProps = input<Record<string, any>>({});
    public readonly showBackdrop = input<boolean>(true);
    public readonly showDots = input<boolean>(true);
    public readonly backdropClose = input<boolean>(true);
    public readonly keyboardClose = input<boolean>(true);
    public readonly blurry = input<boolean>(true);

    public readonly injectedComponent = viewChild("injectedComponent", { read: ViewContainerRef });
    public readonly contentContainer = viewChild.required("content", { read: ViewContainerRef });

    private componentInstance?: Type<new () => any>;

    /**
     *
     */
    private readonly handleKeyDown = (event: KeyboardEvent): void => {
        if (event.key === "Escape" && this.keyboardClose()) {
            this.dismiss({ role: "cancel" });
            return;
        }

        if (event.key === "Tab") {
            this.trapFocus(event);
        }
    }

    /**
     *
     */
    private trapFocus(event: KeyboardEvent): void {
        const focusableElements = this.contentContainer().element.nativeElement.querySelectorAll(
            'a[href], button, textarea, input, select, [tabindex]:not([tabindex="-1"])'
        );

        if (!focusableElements || focusableElements.length === 0) {
            event.preventDefault();
            return;
        }

        const firstElement = focusableElements[0] as HTMLElement;
        const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

        if (event.shiftKey) {
            if (document.activeElement === firstElement || document.activeElement === this.contentContainer().element.nativeElement) {
                lastElement.focus();
                event.preventDefault();
            }
        } else {
            if (document.activeElement === lastElement) {
                firstElement.focus();
                event.preventDefault();
            }
        }
    }

    /**
     *
     */
    protected backdropClick(event: MouseEvent): void {
        const target = event.target as HTMLElement;

        if (
            this.backdropClose()
            && (target.classList.contains("modal") || target.classList.contains("modal-backdrop"))
        ) {
            this.dismiss({ role: "cancel" });
        }
    }

    /**
     *
     */
    public getComponentInstance<T>(): T | undefined {
        return this.componentInstance as T | undefined;
    }

    /**
     *
     */
    public ngAfterViewInit(): void {
        setTimeout(() => {
            if (this.contentContainer()?.element?.nativeElement) {
                this.contentContainer().element.nativeElement.focus();
            }
        }, 50);
    }

    /**
     *
     */
    public override ngOnDestroy(): void {
        document.body.classList.remove("modal-open");
        document.removeEventListener("keydown", this.handleKeyDown);

        const c = this.injectedComponent();
        c?.clear();

        super.ngOnDestroy();
    }

    /**
     *
     */
    public ngOnInit(): void {
        const component = this.injectedComponent()?.createComponent(this.component(), {
            environmentInjector: this.appRef.injector,
        });

        if (component?.instance) {
            this.componentInstance = component.instance;

            for (const key in this.componentProps()) {
                component.setInput(key, this.componentProps()[key]);
            }
        }

        document.addEventListener("keydown", this.handleKeyDown);

        document.body.classList.add("modal-open");
    }
}
