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

import { Type } from "@angular/core";
import { UIComponent } from "src/app/shared/ui/UIComponent.directive";

/* UI - Global */

export type UIButtonRole = "cancel" | "confirm" | "none" | "destructive";

export type UIColor =
    | "primary"
    | "secondary"
    | "tertiary"
    | "danger"
    | "success"
    | "warning"
    | "light"
    | "dark"
    | "medium"
    | "default";

export type ExtendedUIColor =
    | UIColor
    | "transparent"
    | "primary-gradient"
    | "danger-gradient"
    | "warning-gradient"
    | "success-gradient"
    | "windows"
    | "windows-error"
    | "windows-light";

export interface UIAction {
    text: string;
    role: UIButtonRole;
    handler?: (self: UIComponent, action: UIAction) => void;
    icon?: string;
    color?: ExtendedUIColor;
}

export interface UIIconAction extends UIAction {
    icon?: string
}

export interface UIDismissData<T = any> {
    role: UIButtonRole;
    data: T;
}

export interface UIConfig {
    id?: string;
    classes?: string;
}

/* Alert */

export interface AlertConfig extends UIConfig {
    title?: string;
    message?: string;
    duration?: number;
    details?: string;
    actions?: UIAction[];
    color?: ExtendedUIColor;
}

/* Modal */

export interface ModalConfig extends UIConfig {
    /** */
    component: Type<any>;
    /** @default {} */
    componentProps?: Record<string, any>;
    /** @default true */
    showBackdrop?: boolean;
    /** @default true */
    showDots?: boolean;
    /** @default true */
    backdropClose?: boolean;
    /** @default true */
    keyboardClose?: boolean;
    /** @default true */
    animated?: boolean;
    /** @default true */
    blurry?: boolean;
}

/* Toast */

export type ToastPosition = "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-center" | "bottom-right";

export interface ToastConfig extends UIConfig {
    /** */
    message: string;
    /** @default 0 (infinite) */
    duration?: number;
    /** @default [] */
    actions?: UIIconAction[];
    /** @default "medium" */
    color?: UIColor;
    /** @default false */
    closable?: boolean;
    /** @default "top-center" */
    position?: ToastPosition;
}

export interface LoadingConfig extends UIConfig {
    message?: string;
}

/* Select */

export interface SelectOption<T> extends UIIconAction {
    value: T;
}
