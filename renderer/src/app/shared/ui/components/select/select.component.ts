/*
 * Quark
 * Copyright (C) 2026 NoxFly
 *
 * FR : Ce programme est un logiciel libre ; vous pouvez le redistribuer ou le
 * modifier selon les termes de la GNU Affero General Public License, version 3,
 * telle que publiée par la Free Software Foundation. Il est distribué dans
 * l'espoir d'être utile, mais SANS AUCUNE GARANTIE. Voir le fichier LICENSE.
 *
 * EN : This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License, version 3, as
 * published by the Free Software Foundation. It is distributed in the hope that
 * it will be useful, but WITHOUT ANY WARRANTY. See the LICENSE file.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { ElementRef, OnDestroy, OutputRefSubscription } from "@angular/core";
import { ChangeDetectionStrategy, Component, computed, contentChildren, effect, forwardRef, input, output, signal, viewChild } from "@angular/core";
import type { ControlValueAccessor } from "@angular/forms";
import { NG_VALUE_ACCESSOR } from "@angular/forms";
import { SelectOptionComponent } from "./select-option/select-option.component";

@Component({
    selector: "ui-select",
    standalone: true,
    templateUrl: "./select.component.html",
    styleUrls: ["./select.component.scss"],
    imports: [],
    providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SelectComponent), multi: true }],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        "[class.opened]": "opened()",
        "[class.multiple]": "multiple() !== false",
        "[attr.tabindex]": "tabindex()",
        "(keydown)": "handleHostKeyDown($event)",
    }
})
export class SelectComponent implements ControlValueAccessor, OnDestroy {
    public readonly placeholder = input<string>("Sélectionnez une option");
    public readonly multiple = input<boolean | "">(false);
    public readonly search = input<boolean | "">(false);
    public readonly clearable = input<boolean | "">(false);
    public readonly selected = input<any | any[]>([]);

    public readonly options = contentChildren(SelectOptionComponent);

    protected readonly _selected = signal<SelectOptionComponent[]>([]);
    protected readonly hasSelected = computed(() => this._selected().length > 0);

    protected readonly selectedEl = viewChild.required<ElementRef<HTMLElement>>("selected");
    protected readonly optionsEl = viewChild.required<ElementRef<HTMLElement>>("options");
    protected readonly searchInputEl = viewChild<ElementRef<HTMLInputElement>>("searchInput");

    public selectionChange = output<SelectOptionComponent[]>();

    protected readonly isSearch = computed(() => this.search() !== false);
    protected readonly searchQuery = signal<string>('');

    private _pendingValue: string | string[] | null = null;

    protected readonly opened = signal<boolean>(false);
    protected readonly tabindex = signal<number>(0);

    private readonly subscriptions = new Set<OutputRefSubscription>();

    protected readonly getSelected = computed(() => {
        if (!this.hasSelected()) {
            return { values: [], text: this.placeholder() };
        }

        return Array.from(this._selected())
            .map((option) => ({ values: option!.value(), text: option!.content() }))
            .reduce(
                (acc, { values, text }) => ({
                    values: [...acc.values, values],
                    text: acc.text ? `${acc.text}, ${text}` : text,
                }),
                { values: [], text: "" },
            );
    });

    /**
     *
     */
    public constructor() {
        effect(() => {
            for (const opt of this._selected()) {
                opt.selected.set(true);
            }
        });

        effect(() => {
            const selectedInput = this.selected();

            if (!selectedInput || (Array.isArray(selectedInput) && selectedInput.length === 0)) {
                return;
            }

            const options = this.options();
            if (options.length === 0) {
                return;
            }

            const selectedValues = Array.isArray(selectedInput) ? selectedInput : [selectedInput];
            const selectedOptions = selectedValues
                .map((value: any) => options.find((opt) => opt.value() === value))
                .filter((opt): opt is SelectOptionComponent => opt !== undefined);

            if (selectedOptions.length > 0) {
                this._selected.set(selectedOptions);
            }
        });

        effect(() => {
            const options = this.options();

            for (const sub of this.subscriptions.values()) {
                sub.unsubscribe();
            }

            this.subscriptions.clear();

            if (options.length > 0) {
                // Attendre un tick pour s'assurer que les inputs sont initialisés
                setTimeout(() => {
                    this.initializeOptions();
                }, 0);
            }
        });
    }

    /**
     *
     */
    protected handleHostKeyDown(event: KeyboardEvent): void {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            this.toggleOptions();
        }
    }

    /**
     *
     */
    public reset(): void {
        this._selected().forEach((option) => { option.selected.set(false); });
        this._selected.set([]);
    }

    public onChange = (value: any): void => {};
    public onTouched = (): void => {};

    /**
     *
     */
    public registerOnChange(fn: any): void {
        this.onChange = fn;
    }

    /**
     *
     */
    public registerOnTouched(fn: any): void {
        this.onTouched = fn;
    }

    // ---

    /**
     *
     */
    public writeValue(value: string | string[] | null): void {
        if (value === undefined || value === null) {
            this._selected.set([]);
            return;
        }

        // Stocker la valeur pour l'utiliser lors de l'initialisation des options
        this._pendingValue = value;

        // Essayer de définir la sélection immédiatement si les options sont disponibles
        this.trySetSelectionFromValue(value);
    }

    /**
     *
     */
    private trySetSelectionFromValue(value: string | string[] | null): void {
        if (value === undefined || value === null) {
            this._selected.set([]);
            return;
        }

        const options = this.options();

        if (options.length === 0) {
            // Les options ne sont pas encore disponibles, on attend
            return;
        }

        if (typeof value === "string") {
            const option = options.find((opt) => opt.value() === value);
            this._selected.set(option ? [option] : []);
        }

        if (Array.isArray(value)) {
            const set = new Set(value);

            const selectedOptions = options.filter((opt) => set.has(opt.value()));

            this._selected.set(selectedOptions);
        }

        // Effacer la valeur en attente une fois traitée
        this._pendingValue = null;
    }

    /**
     *
     */
    public valueChanged(value: any | null): void {
        console.warn("[TO IMPLEMENT] SelectComponent.valueChanged", typeof value, value);
        this.onChange(value ?? []);
        this._selected.set(value ?? []);
    }

    /**
     *
     */
    protected onSelectedClick(): void {
        this.toggleOptions();

        if (this.isSearch()) {
            if (this.opened()) {
                this.searchQuery.set('');
                this.filterOptions('');
                setTimeout(() => this.searchInputEl()?.nativeElement.focus(), 0);
            } else {
                this.filterOptions('');
            }
        }
    }

    /**
     *
     */
    protected onSearchInput(event: Event): void {
        const query = (event.target as HTMLInputElement).value;
        this.searchQuery.set(query);
        this.filterOptions(query);
    }

    /**
     *
     */
    private filterOptions(query: string): void {
        const q = query.toLowerCase().trim();

        for (const option of this.options()) {
            option.filteredOut.set(q.length > 0 && !option.content().toLowerCase().includes(q));
        }
    }

    /**
     *
     */
    protected toggleOptions(): void {
        this.opened.update(o => !o);

        setTimeout(() => {
            const selectedRect = this.selectedEl().nativeElement.getBoundingClientRect();
            const optionsRect = this.optionsEl().nativeElement.getBoundingClientRect();
            const viewportHeight = window.innerHeight;

            const overflowsFromBottom = this.opened() && selectedRect.bottom + optionsRect.height > viewportHeight;

            this.optionsEl().nativeElement.classList.toggle("top-anchor", overflowsFromBottom);
        }, 10);
    }

    /**
     *
     */
    private onOptionSelected(option: SelectOptionComponent): void {
        if (option.disabled()) {
            return;
        }

        if (this.multiple() !== false) {
            const selected = this._selected();

            if (selected.includes(option)) {
                if (selected.length < 2 && this.clearable() === false) {
                    return;
                }

                option.selected.set(false);
                this._selected.update((selectedOptions) =>
                    selectedOptions.filter((selectedOption) => selectedOption !== option),
                );
            } else {
                this._selected.set([...selected, option]);
            }
        } else {
            this.opened.set(false);
            this._selected()[0]?.selected.set(false);
            this._selected.set([option]);

            if (this.isSearch()) {
                this.searchQuery.set('');
                this.filterOptions('');
            }
        }

        this.selectionChange.emit(this._selected());

        if (this.multiple() !== false) {
            this.onChange(this._selected().map((opt) => opt.value()));
        } else {
            this.onChange(this._selected()[0]?.value());
        }
    }

    /**
     *
     */
    private initializeOptions(): void {
        const defaultSelection: SelectOptionComponent[] = [];
        const selected: SelectOptionComponent[] = [];

        const hasOptionSelected =
            this.selected() !== undefined && this.selected() !== null && this.selected().length > 0;

        this.options().forEach((option) => {
            // Vérifier que l'option a bien une valeur avant de procéder
            const optionValue = option.value();
            if (optionValue === undefined || optionValue === null) {
                console.warn("Option sans valeur détectée, initialisation reportée");
                return;
            }

            const sub = option.optionSelected.subscribe(this.onOptionSelected.bind(this));

            this.subscriptions.add(sub);

            if (option.isDefaultSelected()) {
                defaultSelection.push(option);
            }

            if (hasOptionSelected) {
                if (this.multiple() !== false) {
                    if (this.selected().includes(optionValue)) {
                        selected.push(option);
                    }
                } else {
                    if (this.selected() === optionValue) {
                        selected.push(option);
                    }
                }
            }
        });

        // Vérifier s'il y a une valeur en attente du ControlValueAccessor
        if (this._pendingValue !== null) {
            this.trySetSelectionFromValue(this._pendingValue);
        } else if (hasOptionSelected && selected.length > 0) {
            this._selected.set(selected);
        } else if (defaultSelection.length > 0) {
            this._selected.set(defaultSelection);
        }
    }

    /**
     *
     */
    public ngOnDestroy(): void {
        for (const sub of this.subscriptions.values()) {
            sub.unsubscribe();
        }

        this.subscriptions.clear();
    }
}
