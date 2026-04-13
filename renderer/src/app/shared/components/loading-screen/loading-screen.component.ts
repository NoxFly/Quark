import { ChangeDetectionStrategy, Component, HostBinding, input, ViewEncapsulation } from "@angular/core";
import { SpinnerComponent } from "src/app/shared/ui/components/spinner/spinner.component";

@Component({
    selector: "app-loading-screen",
    standalone: true,
    templateUrl: "./loading-screen.component.html",
    styleUrl: "./loading-screen.component.scss",
    encapsulation: ViewEncapsulation.None,
    imports: [SpinnerComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoadingScreenComponent {
    public readonly message = input<string>();
    public readonly showContent = input<boolean>(true);

    @HostBinding("class.fade-in")
    protected get fadeIn(): boolean {
        return !this.showContent();
    }
}
