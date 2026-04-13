/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import {
    ApplicationRef,
    ChangeDetectorRef,
    ComponentRef,
    createComponent,
    Directive,
    DOCUMENT,
    ElementRef,
    inject,
    Injectable,
    input,
    output,
    signal,
    Type
} from "@angular/core";
import { UIAction, UIColor, UIConfig, UIDismissData } from "src/app/shared/ui/ui.types";

@Directive({
    standalone: true,
    host: {
        "[class]": "classes() + (disappearing() ? ' disappearing' : '')",
        "[attr.id]": "id() || null",
    }
})
export abstract class UIComponent {

    protected readonly document = inject(DOCUMENT);
    protected readonly appRef = inject(ApplicationRef);
    protected readonly ref = inject(ElementRef<HTMLElement>);
    protected readonly cdr = inject(ChangeDetectorRef);

    public readonly classes = input<string>("");
    public readonly id = input<string>("");
    public readonly animated = input<boolean>(true); // pas disponible pour tous les composants

    public willDismiss = output<UIDismissData>();
    public didDismiss = output<UIDismissData>();

    public componentRef!: ComponentRef<UIComponent>;

    public readonly disappearing = signal<boolean>(false);

    private destroyed = false;

    /**
     *
     */
    public ngOnDestroy(): void {
        this.destroyed = true;
    }

    /**
     *
     */
    public dismiss(e?: Partial<UIDismissData>): void {
        const defaultData: UIDismissData = { role: "none", data: undefined };
        const d = Object.assign(defaultData, e);

        if (!this.destroyed) {
            this.willDismiss.emit(d);
        }

        const onAnimationEnd = (): void => {
            if (this.componentRef) {
                this.componentRef?.destroy();
            } else {
                this.ref.nativeElement.remove();
            }
            // Vérifier que le composant n'est pas détruit avant d'émettre
            if (!this.destroyed) {
                this.didDismiss.emit(d);
            }
        };

        this.disappearing.set(true);
        this.cdr.detectChanges();

        if (this.animated()) {
            this.ref.nativeElement.addEventListener("animationend", onAnimationEnd, { once: true });
        } else {
            onAnimationEnd();
        }
    }

    /**
     *
     */
    protected onActionClicked(action: UIAction): void {
        action.handler?.(this, action);

        if (action.role === "cancel") {
            this.dismiss({ role: action.role });
        }
    }

    /**
     *
     */
    protected getButtonRoleClass(action: UIAction): UIColor {
        switch (action.role) {
            case "cancel":
                return "default";
            case "confirm":
                return "primary";
            case "destructive":
                return "danger";
            default:
                return "default";
        }
    }
}

@Injectable({ providedIn: "root" })
export abstract class UIController<T extends UIComponent, C extends UIConfig> {
    private readonly document = inject(DOCUMENT);
    private readonly appRef = inject(ApplicationRef);

    /**
     *
     */
    protected async instanciate(component: Type<T>, config: C): Promise<T> {
        const componentRef: ComponentRef<T> = createComponent(component, { environmentInjector: this.appRef.injector });

        for (const key in config) {
            if (config[key] !== undefined) {
                componentRef.setInput(key, config[key]);
            }
        }

        this.appRef.attachView(componentRef.hostView);

        const uiEl = (componentRef.hostView as any).rootNodes[0];

        this.document.body.appendChild(uiEl);
        uiEl.dataset.uiName = this.constructor.name.replace(/Controller|_/g, "").toLowerCase();
        uiEl.dismiss = componentRef.instance.dismiss.bind(componentRef.instance);

        (componentRef.instance as UIComponent).componentRef = componentRef;

        await (() => new Promise<void>((resolve) => setTimeout(resolve, 2)))();

        return componentRef.instance;
    }

    /**
     *
     */
    public abstract create(config: C): Promise<T>;

    /**
     * Dissmisses the top-most current UIComponent
     */
    public dismiss(e?: Partial<UIDismissData>): void {
        const componentName = this.constructor.name.replace(/Controller|_/g, "").toLowerCase();
        const children = this.document.body.querySelectorAll(`[data-ui-name="${componentName}"]:not(.disappearing)`);
        const lastChild = children[children.length - 1] as any;
        lastChild?.dismiss(e);
    }
}
