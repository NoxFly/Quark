# SQLiteEditor — Copilot Instructions

Application Electron + Angular 21 permettant d'éditer des bases SQLite. Architecture en deux processus distincts communiquant via IPC.

## Architecture

```
main/       ← Processus Electron/Node.js, bundlé par tsup → dist/main.js + dist/preload.js
renderer/   ← Angular 21, bundlé par Angular CLI → dist/browser/
shared/     ← Types TypeScript partagés entre main et renderer (types.d.ts, ipc-renderer.d.ts)
```

### Flux de communication

Le renderer appelle `window.ipcRenderer.invoke(channel, ...args)` (exposé via `contextBridge` dans le preload). Le preload appelle également `exposeNoxusBridge()` pour le transport Noxus. Côté main, le framework **Noxus** route les requêtes vers des `@Controller()` et `@Get("path")`.

Le main peut pousser des événements au renderer via `ipcMain.emit` sur les canaux `navigate-to` et `display-error-dialog`.

**Canaux IPC directs (hors Noxus) :** `load-app`, `request-reload`, `close-app`, `reduce-app`, `toggle-fullscreen`, `get-titlebar-state`.

### Framework Noxus (`@noxfly/noxus`)

Framework maison qui apporte une DI et un routage NestJS-like dans le main Electron.

- **Main** : `bootstrapApplication({ routes, eagerLoad })`, `defineRoutes([])`, `@Injectable({ lifetime: "singleton"|"transient" })`, `@Controller()`, `@Get("path")`, `inject(Token)`, `IApp`
- **Preload** : `exposeNoxusBridge()`
- **Renderer** : `NoxRendererClient` (base de `NoxusService`), `request<T>(method, path, body?)`, `batch(...)`

`AppController` dans `main/src/modules/app/` expose la route `GET app/state`. Ajouter de nouvelles routes : créer un controller dans `modules/`, déclarer dans `app.routes.ts`.

### Services stubs (à implémenter)

`AppTab` et `Database` (dans `main/src/core/services/`) sont intentionnellement vides — ils seront l'unité d'état par onglet ouvert. `AppService.getState()` retourne un stub hardcodé pour l'instant.

### Drivers de base de données

Les drivers implémentent `DatabaseDriver` (`main/src/core/drivers/`). Les drivers réseau étendent `NetworkSqlDriver`. Types supportés : `sqlite`, `mysql`, `postgresql`, `oracle`, `mssql`, `azure`, `mongodb`. **Azure SQL** (`azure-sql.driver.ts`) étend `MssqlDriver` et force le chiffrement TLS via `getTlsOptions()` (`encrypt: true`) — il hérite de toutes les fonctionnalités MSSQL, procédures stockées incluses. Il supporte deux modes d'authentification via `configureAuth()` + override de `getAuthentication()` : `sql` (login/mot de passe SQL Server) et `service-principal` (Microsoft Entra ID via `azure-active-directory-service-principal-secret` : `clientId` + `clientSecret` + `tenantId`, sans identifiant utilisateur). Le `clientSecret` réutilise le champ secret de la connexion (`password`) ; `clientId`/`tenantId` sont non secrets. Le mode est porté par `R_NetworkConnectBody`/`ConnectionProfile` (`authMode`, `clientId`, `tenantId`) et appliqué dans `Application.openNetworkConnection`. Pour ajouter un driver : créer la classe, l'enregistrer dans `driver-registry.ts` (`DRIVER_CATEGORIES`, `DRIVER_INFOS`, `createDriver`), l'exporter dans `drivers/index.ts`, ajouter le type dans `shared/driver.d.ts` et le logo/couleur dans `open-database.page.ts`.

### Connexions sauvegardées (coffre chiffré)

Système distinct de l'historique « bases récentes ». Les profils de connexion (identifiants inclus) sont persistés dans `connections.xml` (userData), chiffré AES-256-GCM par une clé dérivée (scrypt) d'un **mot de passe maître** déverrouillé une fois par session. `ConnectionStore` (`main/src/core/services/connection-store.ts`) gère le coffre ; `connection-crypto.ts` fournit le chiffrement et l'enveloppe XML. Les profils peuvent être **exportés** en fichier XML chiffré par une **passphrase** indépendante et **importés** ailleurs, pour partager l'accès à une base sans divulguer les identifiants (mots de passe write-only, jamais réaffichés). Canaux IPC : `conn-status`, `conn-initialize`, `conn-unlock`, `conn-lock`, `conn-list`, `conn-create`, `conn-update`, `conn-delete`, `conn-connect`, `conn-export`, `conn-import`. Côté renderer : `ConnectionsService`, modal `connections-manager` (File > Connections) et formulaire réutilisable `connection-form`. Types partagés dans `shared/connection.d.ts`.

### Stored Procedures (MSSQL / Azure)

Le driver MSSQL expose des méthodes pour lister, détailler, exécuter, modifier et supprimer les procédures stockées via `tedious`. Les routes sont exposées dans `DbController` (`db/stored-procedures`, `db/stored-procedure-detail`, `db/stored-procedure-exec`, `db/stored-procedure-modify`, `db/stored-procedure-drop`). Côté renderer, `StoredProceduresService` gère l'état et la communication ; la sidebar affiche une section « Stored Procedures » conditionnelle (basée sur `DriverCapabilities.storedProcedures`). La page dédiée (`views/dashboard/stored-procedure/`) intègre un éditeur Monaco pour la définition et un formulaire dynamique pour les paramètres d'entrée.

## Build & Dev

```bash
npm run dev          # build main (dev) + lance Electron (source maps activées)
npm run build        # build main (prod) + build renderer (prod)
npm run typecheck    # tsc --noEmit
npm run check        # biome check --write . (lint + format)
npm run make         # electron-builder → installeur distributable
```

> En développement, le renderer est chargé depuis le serveur Angular sur `localhost:4200`. En production, depuis `dist/browser/`.

## Conventions — Main (Node.js / Noxus)

- **Path alias** : `src/*` → `main/src/*`, `@shared/*` → `shared/*`
- `inject()` pour l'injection de dépendances (pas de constructeur DI)
- Les services singleton (un par app) : `lifetime: "singleton"` ; par onglet/connexion : `lifetime: "transient"`
- Les `BrowserWindow` sont gérées uniquement via la classe `Window` (`main/src/core/services/window.ts`)
- Toujours utiliser `Logger` de Noxus, jamais `console.log`

## Conventions — Renderer (Angular 21)

- **Tous** les composants sont `standalone: true` avec `ChangeDetectionStrategy.OnPush`
- Injection systématique via `inject()` ; **aucun** constructeur avec paramètres injectés
- État local via **signals** : `signal()`, `computed()`, `input()`, `model()`
- Subscriptions RxJS : étendre `SubscriptionManager` et utiliser `this.watch$ = observable` (pas de `.subscribe()` manuel)
- Pages : fichiers `*.page.ts/.html/.scss` dans `views/<feature>/`
- **Sélecteurs** : composants app → `app-*` ; composants UI partagés → `ui-*`
- Path aliases : `@shared/*` → `shared/*`, `@ui/*` → `renderer/src/app/shared/ui/components/*`

### Composants UI (`shared/ui/`)

Tous les composants UI étendent `UIComponent` (directive abstraite). Instanciation dynamique via des contrôleurs (`AlertController`, `ModalController`) avec `controller.create(config)`. Couleurs disponibles : `UIColor` (`primary`, `secondary`, `danger`, `success`, `warning`…) et `ExtendedUIColor` (`transparent`, `*-gradient`, `windows-*`).

La pipe `bypass` contourne la sanitisation Angular (`bypass:'html'|'style'`) — à utiliser uniquement pour du contenu interne maîtrisé.

## Linting (Biome)

- Indentation : **4 espaces**, ligne max : **120 caractères**
- **Doubles quotes**, `operatorLinebreak: "before"`
- `noNonNullAssertion` et `useForOf` sont désactivés
- Lancer `npm run check` avant tout commit

## Types partagés (`shared/`)

Modèles à connaître : `AppState`, `AppTabState`, `DatabaseSchema`, `TableSchema`, `FieldDef`, `Record`. DTOs de connexion : `R_ConnBody`, `R_ConnResponse`, `R_ConnPasswordBody`, `R_ConnPasswordResponse`. Ces types sont importables dans le main via `@shared/types` et dans le renderer directement (`shared/`).



## Coding Guidelines

### Indentation

Use spaces, 4 for any file type, except yml that are 2 spaces.

### Naming Conventions

- Use PascalCase for type names.
- Use PascalCase for class names.
- Use PascalCase for interface names, do not prefix with `I`.
- Use PascalCase for enum names and enum values (e.g., `ApiEndpoint.CashRegisters`).
- Choose wisely enum over union types or consts.
- Prefer interfaces over types when possible.
- Use camelCase for function and method names.
- Use camelCase for property names and local variables.
- Use whole words in names when possible.
- Use kebab-case for file names, and avoid using the same name for multiple files in different directories to prevent confusion. Exception : les acronymes métier en majuscules (ex: `API/`) sont tolérés.
- Suffix file names with their role (e.g., `.service.ts`, `.controller.ts`, `.module.ts`, `.guard.ts`, `.middleware.ts`, `.helper.ts`, `.entity.ts`, `.sync.ts`, `.component.ts`, `.directive.ts`, `.pipe.ts`) to make it clear what the file contains and its role in the architecture.

### Types

- Do not export types or functions unless you need to share it across multiple components.
- Do not introduce new types or values to the global namespace unless they are truly global concepts.
- Always declare types in a separate file than the implementation.

### Comments

- Use JSDoc style comments for functions, interfaces, enums, and classes.
- Always include a description of what the function/class/interface/enum does, its parameters, its return value and an example (if applicable).
- Use inline comments to explain why a particular implementation was chosen, especially if it's not obvious. Avoid stating what the code is doing, and instead focus on the reasoning behind it.

### Strings

- Always use "double quotes" for strings.
- Use template literals for string interpolation and multi-line strings instead of concatenation.

### Style

- Use arrow functions `=>` over anonymous function expressions.
- Only surround arrow function parameters when necessary.
- Only surround arrow function bodies with curly braces when they are not a direct return of an expression.
- Always surround loop and conditional bodies with curly braces.
- Open curly braces always go on the same line as whatever necessitates them.
- Use Stroustrup style for control statements (the `else` is on a new line after the closing brace of the `if`).
- Whenever possible, use in top-level scopes `export function x(…) {…}` instead of `export const x = (…) => {…}`. One advantage of using the function keyword is that the stack-trace shows a good name when debugging.

### Code Quality

- All files must include the NoxFly copyright header
- Prefer `async`/`await` over `Promise` and `.then()` calls.
- Always await a promise to make the function appearable in the stack trace, unless you have a good reason not to (e.g., you want it to run in the background and don't care about errors).
- Look for existing test patterns before creating new structures.
- Prefer regex capture groups with names over numbered capture groups.
- If you create any temporary new files, scripts, or helper files for iteration, clean up these files by removing them at the end of the task.
- Never duplicate imports. Always reuse existing imports if they are present.
- When removing an import, do not leave behind blank lines where the import was. Ensure the surrounding code remains compact.
- Do not use `any` or `unknown` as the type for variables, parameters, or return values unless absolutely necessary. If they need type annotations, they should have proper types or interfaces defined.
- Do not duplicate code. Always look for existing utility functions, helpers, or patterns in the codebase before implementing new functionality. Reuse and extend existing code whenever possible.
- Avoid using `bind()`, `call()` and `apply()` solely to control `this` or partially apply arguments; prefer arrow functions or closures to capture the necessary context, and use these methods only when required by an API or interoperability.
- Always think for the most performant code for future scalability, even if it requires more upfront work. Consider time and space complexity when designing algorithms and data structures, and prefer efficient patterns that will scale well as the codebase grows.
- Always specify the `public`, `private`, or `protected` access modifier for class members, even if the default is public. This improves readability and makes the intended encapsulation clear to other developers.
- Always use explicit return types for functions and methods, even when TypeScript can infer them. This improves readability and helps catch unintended return values or changes in the function's behavior over time.
- Avoid using non-null assertions (`!`). Instead, handle potential null or undefined values explicitly through type guards, default values, or proper error handling to ensure safer and more robust code.
- Always prefer composition over inheritance. Favor creating small, reusable functions and classes that can be combined to achieve complex behavior, rather than relying on deep inheritance hierarchies which can lead to tight coupling and reduced flexibility.
- Always use strict equality (`===` and `!==`) instead of loose equality (`==` and `!=`) to avoid unexpected type coercion and ensure more predictable comparisons.
- Always ensure readme and copilot-instructions files are updated to reflect any architectural, structural, or convention changes made to the codebase. These documents serve as the primary reference for other developers and must accurately represent the current state of the project.
- Do not hesitate to refactor existing code to improve readability, maintainability, or performance, even if it is not directly related to the task at hand. Continuous improvement of the codebase is essential for long-term success and developer satisfaction.
- Do not hesitate to ask for help or clarification if a request is unclear.
- Do not hesitate to suggest improvements or optimizations if you see an opportunity, even if it's outside the scope of your current task.

#### Angular Components

C'est une question d'architecture qui dépend du contexte, mais voici la vision généralement admise :

---

##### Ce qui est OK dans un composant

- Logique de **présentation pure** : gérer l'état local de l'UI (menu ouvert/fermé, onglet actif, loading state)
- Appels aux services et **assignation du résultat** à une propriété
- **Réactions aux événements** utilisateur simples (`onClick`, `onChange`)
- Logique de **formulaire** si elle est courte et spécifique à ce composant

---

##### Ce qui doit sortir du composant

| Logique                                       | Où la mettre                 |
|-----------------------------------------------|------------------------------|
| Appels HTTP / base de données                 | Service                      |
| Transformations / calculs métier              | Service ou helper            |
| Logique partagée entre composants             | Service                      |
| Validation complexe                           | Service ou classe validator  |
| Logique réutilisable pure (formatage, tri...) | Fonction utilitaire / helper |

---

##### Le signe qu'il y a trop de logique dans un composant

- Le composant fait **plus de 200-300 lignes**
- Code dupliqué dans plusieurs composants
- Le composant est **difficile à tester** unitairement
- Avoir du mal à **expliquer en une phrase** ce que fait le composant

---

##### La règle simple

> Un composant devrait savoir **quoi afficher** et **quand réagir**, mais pas **comment calculer ou fetcher**.

```ts
// ✅ Composant bien délimité
export class UserListComponent {
  users = signal<User[]>([]);

  constructor(private userService: UserService) {}

  ngOnInit() {
    this.userService.getActiveUsers().subscribe(u => this.users.set(u));
  }

  onDelete(id: string) {
    this.userService.delete(id).subscribe(() =>
      this.users.update(list => list.filter(u => u.id !== id))
    );
  }
}
```

```ts
// ❌ Trop de logique dans le composant
export class UserListComponent {
  users: User[] = [];

  ngOnInit() {
    fetch('/api/users')
      .then(r => r.json())
      .then(data => {
        this.users = data
          .filter(u => u.active && u.role !== 'admin')
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(u => ({ ...u, displayName: `${u.firstName} ${u.lastName}` }));
      });
  }
}
```
