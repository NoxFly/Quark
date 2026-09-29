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

import { Directive, OnDestroy } from "@angular/core";
import { fromEventPattern, Observable, Subject } from "rxjs";
import { takeUntil } from "rxjs/operators";

/**
 * Service qui permet de facilement écouter des observables
 * en arrêtant d'écouter une fois que l'on n'en a plus besoin.
 * Cela permet de faciliter l'utilisation des subscribes sans devoir
 * penser à gérer les unsubscribe, et évitant les memory leaks.
 *
 * Toute classe utilisant des observables et qui subscribe à ces observables
 * doit étendre cette classe et faire ceci :
 *
 * this.watch$ = observable.pipe(...);
 *
 * au lieu de :
 *
 * observable.pipe(...).subscribe(...);
 *
 * De plus, observable.subscribe(...) ne doit pas être utilisé.
 *
 * Un évènement qui doit être écouté toute la durée de vie de la classe ou de l'application
 * n'a pas besoin de faire this.watch$ = observable.pipe(...);
 */
@Directive()
export class SubscriptionManager implements OnDestroy {
    protected readonly closedSubject = new Subject<void>();

    public get closed$(): Observable<void> {
        return this.closedSubject.asObservable();
    }

    public get untilDestroyed() {
        return <U>(source: Observable<U>) => source.pipe(takeUntil<U>(this.closed$));
    }

    /**
     * subcribe to an observable until ngOnDestroy is called
     */
    protected set watch$(observable: Observable<any>) {
        observable.pipe(this.untilDestroyed).subscribe();
    }

    /**
     * Utilisé pour intégrer un signal output emitter (Angular 20+) dans un flux observable RxJS
     */
    protected eventToObservable<T>(outputEmitter: { subscribe: (handler: (value: T) => void) => unknown }): Observable<T> {
        return fromEventPattern<T>(
          (handler) => outputEmitter.subscribe(handler),
          (handler, subscription) => subscription.unsubscribe()
        );
    }

    /**
     * Implémentation à garder pour que le untilDestroyed fonctionne
     */
    public ngOnDestroy(): void {
        this.closedSubject.next();
        this.closedSubject.complete();
    }
}
