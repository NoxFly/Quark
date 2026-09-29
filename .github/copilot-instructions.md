# Quark — Copilot Instructions

Application Electron + Angular 21 de visualisation et d'édition de bases de données (SQLite local ou distant — libSQL / Turso —, MySQL/MariaDB, PostgreSQL, Oracle, SQL Server, Azure SQL, MongoDB). Projet personnel de NoxFly, sous licence **AGPL-3.0-only** (voir `LICENSE`).

Trois processus : le **main** (fenêtres, IPC, coffre, mises à jour), un **hôte de drivers** par fenêtre (utilityProcess) et le **renderer** Angular.

## Architecture

```
main/       ← Processus Electron/Node.js, bundlé par tsup → dist/main.js, dist/driver-host.js, dist/preload.js
renderer/   ← Angular 21, bundlé par Angular CLI → dist/browser/
shared/     ← Types TypeScript partagés entre main et renderer (types.d.ts, ipc-renderer.d.ts)
```

### Flux de communication

**Toute** la communication renderer ↔ main passe par **Noxus** : aucun `ipcMain.handle`, aucun canal brut. Le preload (`main/src/preload.ts`) n'expose que la poignée de main Noxus (`exposeNoxusBridge()`) et `window.quark.getPathForFile` (chemin d'un fichier déposé, `webUtils`). Noxus transporte requêtes et réponses sur un `MessagePort` transféré une fois à la page : les données ne traversent pas le `contextBridge`, ce qui évite deux copies complètes des gros résultats.

Côté renderer, `NoxusService.ipc` implémente l'interface `IpcRendererBridge` (`shared/ipc-renderer.d.ts`) au-dessus des routes (`renderer/src/app/core/services/noxus-ipc.bridge.ts`) : les appelants gardent une API à méthodes, et la table méthode → route vit dans ce seul fichier. `NoxusService.request` attend la fin de la poignée de main (la titlebar émet des requêtes avant elle), convertit les réponses d'erreur en `NoxusRequestError` (`status` + message du main) et applique une échéance de 30 s ; les opérations dont la durée dépend de la base (SQL, import/export, ouverture, dialogues natifs) la désactivent (`timeout: 0`). Le journal des réponses de Noxus n'est actif qu'en développement.

Routes (`main/src/modules/app.routes.ts`) : `app/*`, `window/*` (cycle de vie et titlebar), `db/*` (base de la fenêtre), `connections/*` (coffre), `update/*`, `session-diff/*`. Les lectures sont des `GET`, tout ce qui modifie la base ou l'état est un `POST`. Le corps d'une requête est toujours un objet (un argument primitif est enveloppé : `{ table }`, `{ id }`…).

Le main pousse ses événements par le socket Noxus : `Window.sendToRenderer(event, payload)` pour une fenêtre, `NoxSocket.emit` pour toutes (mises à jour). Événements : `navigate-to`, `open-file`, `title-changed`, `display-error-dialog`, `update-available`, `update-progress`, `session-diff-changed`. Le renderer s'y abonne par les `on*` du bridge (un seul abonné par événement, le dernier remplace le précédent).

### Framework Noxus (`@noxfly/noxus`)

Framework maison qui apporte une DI et un routage NestJS-like dans le main Electron.

- **Main** : `bootstrapApplication({ routes, eagerLoad })`, `defineRoutes([])`, `@Injectable({ lifetime: "singleton"|"transient" })`, `@Controller()`, `@Get("path")`, `inject(Token)`, `IApp`
- **Preload** : `exposeNoxusBridge()`
- **Renderer** : `NoxRendererClient` (base de `NoxusService`), `request<T>(method, path, body?)`, `batch(...)`

`AppController` dans `main/src/modules/app/` expose la route `GET app/state`. Ajouter de nouvelles routes : créer un controller dans `modules/`, déclarer dans `app.routes.ts`.

### Hôte des drivers (utilityProcess)

Les drivers ne tournent **pas** dans le main : chaque `Window` possède un `RemoteDriver` (`main/src/core/driver-host/remote-driver.ts`) qui implémente `DatabaseDriver` et relaie chaque appel à un utilityProcess dédié (`dist/driver-host.js`, point d'entrée `main/src/driver-host.ts`). Une requête lourde, le module natif SQLite (synchrone) ou un client réseau bloqué ne gèlent donc ni le main ni les autres fenêtres, et un driver qui plante n'emporte pas l'application.

- Le protocole est dans `driver-host.protocol.ts` ; la logique de l'hôte, indépendante du transport et testée, dans `driver-host.service.ts` (`DriverHost`). Seules les méthodes publiques du driver sont appelables.
- Les accesseurs synchrones (`isOpen`, `path`, `isInTransaction`) lisent l'état recopié avec chaque réponse de l'hôte.
- Le process est créé au premier appel et arrêté à la fermeture de la fenêtre (événement `closed`, Alt+F4 compris). S'il s'arrête de lui-même, les appels en cours échouent avec un message explicite, le diff de session est vidé et le renderer reçoit `display-error-dialog` ; l'appel suivant relance un hôte.
- `execSqlPaged` / `fetchSqlRows` : l'éditeur SQL ne reçoit que la première page d'un SELECT (`SQL_FIRST_PAGE_SIZE`, 500 lignes). L'hôte garde le résultat (au plus `SQL_MAX_RESULT_ROWS`, 200 000 lignes, au-delà `truncated`) et en sert les pages suivantes. Seuls les 4 derniers résultats sont conservés ; une fermeture ou une réouverture les invalide. Le driver SQLite lit en flux (`iterate()`) et s'arrête au plafond.
- Les drivers importent `Logger` depuis `@noxfly/noxus` (entrée « child », sans Electron), jamais depuis `@noxfly/noxus/main`. L'hôte journalise dans `<userData>/logs/quark-driver.log`.
- `driver-registry.ts` ne contient que des métadonnées (utilisables par le main) ; `driver-factory.ts` (`createDriver`) importe tous les clients et n'est chargé que par l'hôte.
- **Test de connexion** (`testConnection`, méthode de l'hôte comme `execSqlPaged`) : un driver éphémère est créé à côté de celui de la fenêtre, configuré, ouvert sous échéance (`timeoutSeconds`, 15 s par défaut), mesuré puis refermé — la base de la fenêtre n'est pas touchée. Une ouverture qui dépasse l'échéance est refermée dès qu'elle aboutit. Les erreurs sont rendues lisibles par `describeConnectionError` (chaîne `cause` comprise : `fetch` ne dit que « fetch failed »).
- `connection-target.helper.ts` (chargé par le main **et** par l'hôte : ni Electron, ni `@noxfly/noxus/main`) construit la `DriverConnectionTarget` d'une connexion (`location` passée à `open` + `DriverConnectionOptions`) : `buildNetworkTarget`, `buildRemoteSqliteTarget`, `parseMongoUri`, `withDeadline`, `toTimeoutMs`.

### Rendu des grandes tables

La vue table et les résultats de l'éditeur SQL sont virtualisés par `VirtualRows` (`renderer/src/app/shared/helpers/virtual-rows.helper.ts`) : seules les lignes visibles sont dans le DOM, deux lignes d'espacement tiennent la place des autres. Ce n'est pas le viewport du CDK, dont la translation du contenu casse l'en-tête `sticky` d'un `<table>`. Les lignes ont une hauteur fixe (`$row-height`), mesurée à l'exécution. La vue table charge par pages de 200 lignes au défilement.

### Drivers de base de données

Les drivers implémentent `DatabaseDriver` (`main/src/core/drivers/`). Les drivers réseau étendent `NetworkSqlDriver`. Types supportés : `sqlite`, `libsql`, `mysql`, `postgresql`, `oracle`, `mssql`, `azure`, `mongodb`.

- **Dialecte SQLite partagé** : `SqliteDialectDriver` (`sqlite-dialect.driver.ts`) porte tout ce qui ne dépend que du SQL (schéma par `PRAGMA`, pagination sur `_rowid_`, filtres SQL/plein texte, CRUD, DDL, index, export) au-dessus de deux primitives asynchrones (`queryAll`, `run`) et d'un `queryBatch`. `SqliteDriver` (fichier, better-sqlite3 : lecture en flux, transactions, chiffrement) et `LibsqlDriver` (distant) n'implémentent que leur transport.
- **`LibsqlDriver`** (SQLite distant : libSQL / sqld, Turso ; `libsql://`, `https://`, `wss://`…) utilise `@libsql/client/web`, client HTTP / WebSocket en JS pur — le point d'entrée par défaut charge le module natif `libsql`, exclu du paquet (voir Packaging). Les lectures multiples (schéma, page + total) partent en un seul lot, l'import en un lot `write` atomique ; les entiers au-delà de 2^53 sont rendus en chaîne. **Pas de transactions** (`capabilities.transactions: false`) : un serveur libSQL abandonne une transaction interactive au bout de quelques secondes d'inactivité (5 s chez Turso), incompatible avec le mode transaction. Le jeton est passé par `configureConnection({ authToken })`, jamais dans l'URL ouverte (qui devient le `path`, affiché et historisé) ; un `?authToken=` saisi dans l'URL en est retiré. Dans l'UI, c'est le mode « URL distante » de la carte SQLite (`displayName` « SQLite (distant) »).
- **Options de connexion** : `configureConnection(options: DriverConnectionOptions)` (`shared/driver.d.ts`), appelé avant `open` : `ssl` (MySQL/MariaDB et PostgreSQL en mode « require » — chiffré, autorité du certificat non vérifiée —, Oracle en `tcps://`, SQL Server `encrypt` ; Azure force déjà TLS), `timeoutSeconds` (délai d'établissement propre à chaque client ; absent = défaut historique), `uri` (MongoDB : prioritaire sur hôte / port / identifiants, base déduite de l'URI si le formulaire n'en donne pas ; le `path` n'en garde que les hôtes), `authToken` (libSQL), `azureAuth`.
- `truncateTable(table)` (tous les drivers) vide une table par `DELETE` (pas `TRUNCATE`) : annulable dans une transaction et valable dans tous les dialectes.
 **Azure SQL** (`azure-sql.driver.ts`) étend `MssqlDriver` et force le chiffrement TLS via `getTlsOptions()` (`encrypt: true`) — il hérite de toutes les fonctionnalités MSSQL, procédures stockées incluses. Il supporte deux modes d'authentification via `configureAuth()` (appelé par son override de `configureConnection` quand l'option `azureAuth` est fournie) + override de `getAuthentication()` : `sql` (login/mot de passe SQL Server) et `service-principal` (Microsoft Entra ID via `azure-active-directory-service-principal-secret` : `clientId` + `clientSecret` + `tenantId`, sans identifiant utilisateur). Le `clientSecret` réutilise le champ secret de la connexion (`password`) ; `clientId`/`tenantId` sont non secrets. Le mode est porté par `R_NetworkConnectBody`/`ConnectionProfile` (`authMode`, `clientId`, `tenantId`) et appliqué dans `DbService.openNetworkConnection`. Pour ajouter un driver : créer la classe, l'enregistrer dans `driver-registry.ts` (`DRIVER_CATEGORIES`, `DRIVER_INFOS`) et `driver-factory.ts` (`createDriver`), l'exporter dans `drivers/index.ts`, ajouter le type dans `shared/driver.d.ts` et le logo/couleur dans `open-database.page.ts`.

Ouverture côté main (`DbService`) : `openNetworkConnection` / `openRemoteSqlite` passent par `openTarget` (changement de driver — qui remet le diff de session à zéro —, `configureConnection`, `open`), puis enregistrent la base récente sans secret (`connectionType` `network` ou `remote` + `url`). Routes : `db/connect-network`, `db/connect-remote-sqlite`, `db/test-connection` (`R_TestConnectionBody` → `ConnectionTestResult` ; `kind: "file"` ne vérifie qu'existence et lisibilité ; `profileId` complète un mot de passe laissé vide par le secret du profil), `db/truncate-table` (journalisé par `Window.truncateTable` : jusqu'à `BULK_DETAIL_LIMIT` lignes, une suppression par ligne, au-delà une entrée récapitulative + `SessionDiff.markTableAsDeleted`).

**Mots de passe mémorisés** (fichiers SQLite chiffrés) : `db/submit-password` avec `remember: true` range le mot de passe, chiffré par le trousseau du système (`safeStorage`, via `SystemKeychain`), dans `<userData>/remembered-passwords.json`, par chemin normalisé (`RememberedPasswords`). À l'ouverture (`openFile`, `refresh`, profil sans secret), le mot de passe mémorisé est essayé d'abord ; refusé, il est oublié et l'utilisateur est invité à le saisir. Un changement de mot de passe de la base le met à jour. Sans trousseau disponible, rien n'est mémorisé.

### Connexions sauvegardées (coffre chiffré)

Système distinct de l'historique « bases récentes ». Les profils de connexion (identifiants inclus) et leurs **dossiers** sont persistés dans `connections.xml` (userData), chiffré AES-256-GCM par une clé dérivée (scrypt) d'un **mot de passe maître** déverrouillé une fois par session — ou, mot de passe maître désactivé, d'un secret aléatoire lui-même chiffré par le trousseau du système dans `connections.key` : le coffre se déverrouille alors seul à la lecture de `connections/status` (`ConnectionVaultStatus.masterPasswordEnabled`). `connections/master-password` (`ConnectionMasterPasswordBody`) bascule le mode : désactiver exige le mot de passe actuel et un trousseau disponible (sinon refus explicite) ; activer rechiffre le coffre avec le nouveau mot de passe puis supprime le secret. L'ordre des écritures ne laisse jamais un coffre chiffré par une clé perdue ; un secret périmé est écarté à la lecture.

Contenu déchiffré en version 2 : dossiers (`<folder id name order>`) et nouveaux champs de profil (`sqliteMode`, `url`, `uri`, `ssl`, `folderId`, `tag`, `notes`, `lastConnectedAt` — daté à chaque `connections/connect` réussi, sans toucher `updatedAt`). Un coffre en version 1 se lit sans perte (champs absents = valeurs par défaut) et reçoit un dossier « Connexions », écrit aussitôt pour que son identifiant reste stable. Supprimer un dossier déplace ses profils dans le premier dossier restant ; le dernier ne peut être supprimé. Un profil SQLite distant (`driverType: "libsql"`, ou `sqlite` + `sqliteMode: "url"`) range son jeton dans le champ secret. Le builder XML garde `suppressBooleanAttributes: false` : sinon `ssl="true"` s'écrirait en attribut nu, perdu à la relecture. `ConnectionStore` (`main/src/core/services/connection-store.ts`) gère le coffre ; `connection-crypto.ts` fournit le chiffrement et l'enveloppe XML. Les profils peuvent être **exportés** en fichier XML chiffré par une **passphrase** indépendante et **importés** ailleurs, pour partager l'accès à une base sans divulguer les identifiants (mots de passe write-only, jamais réaffichés). La dérivation scrypt est asynchrone (pool de libuv) et les écritures du fichier sont sérialisées. L'export emporte les dossiers des profils exportés (sans `lastConnectedAt`) ; à l'import, un dossier rejoint le dossier local du même nom ou est créé. Routes Noxus : `connections/status`, `initialize`, `unlock`, `lock`, `master-password`, `list`, `create`, `update`, `delete`, `folders`, `folder-create`, `folder-update`, `folder-delete`, `connect`, `export`, `import` (`ConnectionsController` / `ConnectionsService`). Côté renderer : `ConnectionsService`, modal `connections-manager` (File > Connections) et formulaire réutilisable `connection-form`. Types partagés dans `shared/connection.d.ts`.

### Diff de session

Page `/dashboard/session-diff` (onglet dédié, menu Affichage, `Ctrl+Shift+M`) qui montre l'écart entre l'état de la base **à son ouverture** et son état **actuel**. Le périmètre est la session de connexion entière : le mode transaction n'y change rien. Ce système remplace l'ancienne modale `transaction-diff`, supprimée — elle lisait `MutationHistoryService` (renderer, vidé à chaque changement de table et à chaque commit) et n'affichait donc qu'un sous-ensemble instable des modifications. `MutationHistoryService` reste dédié à l'undo/redo.

Deux mises en page, au choix via le toggle de la barre d'outils (persisté en `localStorage`, clé `session-diff-view`, grille par défaut) :

- **grille** : une table HTML par table de la base, champs alignés horizontalement comme dans la vue des données. Une modification occupe deux lignes (`−` avant, `+` après) pour que les colonnes restent alignées ; un insert ou un delete n'en occupe qu'une. Les colonnes sont unifiées **au niveau de la table** (`TableDiffView.columnNames`) et chaque `RowDiffView.columns` suit exactement cet ordre, y compris pour les colonnes absentes d'une ligne (rendues hachurées, distinctes d'un `NULL`) ;
- **fiches** : une carte par ligne, panneaux côte à côte (gauche = à l'ouverture, droite = maintenant), plus lisible sur une table large.

Les deux modes occupent toute la largeur de la page. L'action « redéfinir le point de référence » utilise l'icône `renderer/public/icons/reset-reference.svg`.

Le journal vit dans le **processus principal**, `SessionDiff` (`main/src/core/services/session-diff.ts`), une instance par `Window`. Il est **exclusivement en mémoire** : il contient le contenu réel des lignes, l'écrire sur disque exfiltrerait en clair les données d'une base chiffrée. Il est remis à zéro à l'ouverture et à la fermeture d'une connexion, mais **survit à un rafraîchissement** (`Window.reopenDatabase`) et à un `Ctrl+Alt+R`.

L'agrégation est **par ligne**, pas chronologique : chaque ligne touchée porte son image d'origine et son image courante, si bien que deux éditions du même champ donnent une seule entrée et qu'une modification annulée disparaît du diff (`pruneIfUnchanged`). Une ligne insérée puis supprimée disparaît également. Les bornes de transaction sont suivies (`beginTransaction` / `commitTransaction` / `rollbackTransaction`) : un `ROLLBACK` restaure le journal comme il restaure la base.

La capture des images avant/après se fait dans `Window` (`updateCell`, `batchUpdate`, `deleteRows`, `insertRow`) — les routes de `DbController` passent par ces méthodes, jamais directement par le driver. Au-delà de `BULK_DETAIL_LIMIT` (500 lignes), une opération en lot devient une entrée récapitulative, mais les lignes déjà suivies sont réconciliées pour ne pas rester obsolètes. Le SQL brut de l'éditeur, le DDL et les imports sont journalisés comme **entrées opaques** (`recordOpaqueChange`) : les diffé ligne à ligne imposerait de snapshoter la table cible avant et après. Plafond de suivi : 20 000 lignes (`capped`).

**Annulation d'une modification** (« Discard change » d'un diff git) : action par ligne (grille et fiches) et action globale « annuler toutes les modifications affichées » (respecte le filtre de tables, confirmation obligatoire), masquées en lecture seule. La logique vit dans `SessionReverter` (`main/src/core/services/session-revert.ts`), appelée par `Window.revertSessionRow` / `revertSessionRows` : elle agit **directement sur le driver** et met le journal à jour elle-même (passer par `Window.insertRow`… journaliserait l'annulation comme une nouvelle modification), puis relit chaque ligne pour que `pruneIfUnchanged` la retire du diff — une restauration incomplète y reste visible. Règles :

- UPDATE → `updateCell` des seules colonnes modifiées vers l'image d'origine ; INSERT → suppression de la ligne ; DELETE → réinsertion de l'image d'origine (sous SQLite / libSQL, `_rowid_` est fixé pour garder l'identifiant d'origine ; ailleurs la clé primaire de l'image suffit), journal aligné par `SessionDiff.recordReinsert` ;
- garde-fous : la ligne est relue et comparée à la dernière image capturée (`row-changed` si elle a été modifiée hors journal, `row-missing` si elle a disparu, `row-exists` si l'identifiant est repris) ; les entrées opaques et récapitulatives ne sont pas annulables, ni une ligne sans image d'origine ou dont une colonne n'existe que d'un côté (`SessionRowDiff.revertible`, calculé par `isRevertible`) ;
- annulation groupée : ordre réinsertions (parents d'abord) → restaurations (parents d'abord) → suppressions des lignes insérées (enfants d'abord), profondeur tirée des clés étrangères du schéma. Si le driver gère les transactions et qu'aucune n'est ouverte, tout se fait dans une transaction ouverte pour l'occasion (SQLite : `PRAGMA defer_foreign_keys`) — au premier échec, base **et** journal sont restaurés (`rolledBack`). Dans une transaction déjà ouverte ou sans transaction, chaque ligne est tentée, les échecs une seconde fois à la fin, et ils sont rapportés (`SessionRevertResult.failures`, motif traduit côté renderer) ;
- confirmation d'une annulation unitaire qui supprime des données (annuler un INSERT) si `confirmDeletions` est actif. La lecture seule n'est connue que du renderer : c'est lui qui masque les actions.

Routes Noxus : `session-diff/snapshot`, `session-diff/summary`, `session-diff/clear`, `session-diff/revert` (POST `{ table, rowid }`), `session-diff/revert-all` (POST `{ rows?, tables? }`, tout le journal si vide) — appelées par `SessionDiffService.revert` / `revertAll`. Événement poussé : `session-diff-changed` (compteurs seulement — l'instantané complet n'est rechargé que si la page est ouverte, via `SessionDiffService.setLive`). Le découpage intra-valeur (surbrillance fine sur le fragment réellement différent) est fait par `diffInline` (`renderer/src/app/shared/helpers/text-diff.helper.ts`, LCS sur jetons, plafonné). Types partagés dans `shared/session-diff.d.ts`.

Les onglets non tabulaires (éditeur SQL, diff de session, diagramme ER, index) sont décrits par le registre `SPECIAL_TABS` de `tabs.service.ts` ; utiliser `getSpecialTab()` et `DatabaseService.activateTab()` plutôt que `selectTable()` pour activer un onglet par son identifiant. L'onglet d'index est paramétré par sa table (`indexesTabId(table)` / `indexesTabTable(id)`, préfixe `INDEXES_TAB_PREFIX`) et s'ouvre par `DatabaseService.openIndexesTab(table)`.

L'historique de l'éditeur SQL (`SqlHistoryService`, 50 entrées par base) est persisté en `localStorage`, **sauf pour une base chiffrée** : il reste alors en mémoire, l'écrire exfiltrerait des requêtes (et leurs valeurs) en clair. Le thème de Monaco est dérivé des tokens `--syntax-*` par `MonacoPreloadService.applyAppTheme()` et suit le thème de l'application.

### Coquille de l'application (titlebar, raccourcis, paramètres)

`ShellService` (`core/services/shell.service.ts`) regroupe les actions déclenchées par les menus de la titlebar, les raccourcis clavier et la page d'accueil : modales (raccourcis, à propos, gestionnaire de connexions, schéma, import, création de table, chiffrement), onglets dédiés (`openSqlEditor`, `openErDiagram`, `openSessionDiff`), plein écran et page Paramètres (`settingsOpen`). Les composants qui n'en dépendent pas passent par des évènements du document écoutés par `AppComponent` : `open-settings`, `open-shortcuts`, `open-about-dialog`, `open-connections-manager`, `open-create-table`, `open-schema-editor`, `open-index-viewer`, `open-change-password`.

- Les raccourcis globaux sont traités dans `AppComponent.handleKeydown` (table `shortcutHandlers`, combinaisons neutres `Ctrl+Shift+S`) ; la liste affichée par la modale est `APP_SHORTCUTS` (`shared/helpers/shortcut.helper.ts`), dont `formatShortcut` traduit les touches (« Ctrl+Maj+C »). Une touche déjà annulée par un composant (Monaco) n'est pas réinterprétée ; `Ctrl+Entrée` valide la transaction hors éditeurs de code. `Ctrl+N` émet `open-new-record` pour la vue table.
- La page Paramètres (`views/settings/settings.page.ts`) est affichée par-dessus l'espace de travail, qui est masqué et non détruit, pour être retrouvé intact au retour.
- `TransactionStatusService` calcule les modifications en attente de la transaction ouverte (écart des compteurs du diff de session depuis `BEGIN`, tables relevées dans l'historique d'annulation) pour le bandeau de transaction et la barre d'état.

### Mise à jour automatique

`UpdaterService` (`main/src/modules/updater/`) recherche, télécharge, vérifie et applique les mises à jour, sans configuration utilisateur. Le manifeste `latest-<os>.json` (`shared/update.d.ts` : `UpdateManifest`) est publié comme asset de la dernière release GitHub et lu à l'URL stable `https://github.com/<repo>/releases/latest/download/latest-<os>.json` — `<repo>` est injecté à la compilation par tsup via `UPDATE_REPOSITORY` (défaut `NoxFly/quark`, fourni par la CI) et exposé dans `environment.update`. Une première recherche a lieu 5 s après le démarrage, puis toutes les heures, et 10 min après un échec (production uniquement) ; le main diffuse alors `update-available` (socket Noxus) à toutes les fenêtres. L'installeur est vérifié par empreinte SHA-512 avant exécution, puis lancé sur Windows avec `--updated /S --force-run` : installation silencieuse, puis relance de l'application — ailleurs il est seulement révélé dans l'explorateur (le paquet deb/rpm exige une élévation).

Deux modes, selon le réglage `autoUpdate` (`SettingsStore`, `<userData>/settings.json`, coché dans le menu Aide, désactivé hors Windows) :

- **manuel** (défaut) : la mise à jour est proposée par une alerte ; « Installer et redémarrer » l'applique d'un clic ;
- **automatique** : l'installeur est téléchargé aussitôt, puis appliqué sans rien demander dès que l'application est inactive — aucune fenêtre au premier plan, ou machine au repos depuis 5 min — et **jamais** avec une transaction ouverte ; l'utilisateur n'est prévenu que par un toast. Si l'application est fermée avant, l'installation se fait à la fermeture, sans relance.

La **version portable** Windows (cible `portable` d'electron-builder, `environment.portableExecutable` renseigné par `PORTABLE_EXECUTABLE_FILE`) ne s'applique jamais de mise à jour seule (`canAutoInstall` faux) : l'installeur créerait une seconde copie installée. Elle s'extrait à chaque lancement dans un dossier temporaire : la liste de raccourcis (« New Window ») relance donc l'exécutable d'origine, pas `process.execPath`. Les associations de fichiers ne sont posées que par l'installeur NSIS.

Avant un redémarrage de mise à jour, les bases SQLite ouvertes sont notées dans `pendingRestore` et rouvertes au lancement suivant (une fenêtre par base ; les connexions réseau ne sont pas rouvertes, leurs mots de passe n'étant pas conservés). Routes Noxus : `update/check`, `update/info`, `update/apply`, `update/open-releases`, `update/settings` (`GET`/`POST`). Événements poussés : `update-available`, `update-progress`. Côté renderer : `UpdateService` (proposition via `AlertController`, progression via `LoadingController`, réglage) et le menu Aide. La comparaison de versions repose sur `Version` (`main/src/core/version.ts`), qui gère le format `major.minor.patch[+build.<n>|-<canal>.<n>]`.

### CI et versions

- `.github/workflows/ci.yml` : typecheck (main + renderer), lint Biome et tests, sur chaque pull request vers `main` ; il est aussi appelé par la release.
- `.github/workflows/release.yml` : à chaque push sur `main` (fusion d'une PR), calcule la version depuis les Conventional Commits écoulés depuis le dernier tag `vX.Y.Z` (`type!:`/`BREAKING CHANGE` → majeure, `feat:` → mineure, sinon correctif ; sans tag, la version de `package.json`). La version est injectée dans `package.json` le temps du build, jamais commitée. `[skip release]` dans le message du commit ne publie rien. Build Windows + Linux, manifeste `latest-<os>.json`, release `vX.Y.Z` créée avec `gh`.
- Les anciens tags `vX.Y.Z-build.N` sont ignorés ; `Version` place `0.1.0` au-dessus de `0.0.1+build.N`, les installations existantes reçoivent donc la mise à jour.

### Robustesse du démarrage

L'écran de chargement est un calque opaque plein écran (z-index 999) qui recouvre jusqu'à la titlebar : toute attente non bornée pendant l'initialisation se présente à l'utilisateur comme une fenêtre entièrement blanche. En conséquence :

- `AppComponent.load()` borne chaque étape (`withTimeout`, `shared/helpers/global.helper.ts`) et rattrape les erreurs dans un `StartupErrorComponent` actionnable (réessayer / recharger) ;
- `main.ts` rattrape un échec de bootstrap Angular et affiche un message minimal sans framework ;
- côté main, `app/state` et `window/state` bornent la lecture du schéma (`withTimeout`, `main/src/core/helpers/async.helper.ts`) : un driver bloqué ne doit jamais retenir le démarrage ;
- `Window` journalise et signale `did-fail-load`, `render-process-gone`, `preload-error`, `unresponsive`, refuse toute navigation hors du document de l'application, et affiche la fenêtre au bout de 8 s même si `ready-to-show` n'a pas été émis ;
- en production le document est chargé via `loadFile` (et non une URL `file://` concaténée), pour supporter les chemins d'installation contenant espaces, accents ou `#` ;
- le fichier passé en ligne de commande est mis en attente **sur la fenêtre** (`Window.setPendingFile`) et remis au renderer via `window/load`, plutôt que poussé sur un minuteur qui pouvait expirer avant lui. Les fenêtres sont créées par `Application.openNewWindow()`, qui les enregistre via le callback `onCreated` de `Window.create` **avant** le chargement du document : le renderer émet ses premières requêtes IPC pendant celui-ci, et une fenêtre enregistrée après serait introuvable par `senderId` ;
- toute relance de l'exécutable pendant qu'une instance tourne (liste de raccourcis Windows, double-clic sur un fichier associé) arrive dans `second-instance` : le drapeau `--new-window` ouvre une fenêtre, un argument fichier ouvre la base, et une relance nue remonte la fenêtre existante. Le tri des arguments se fait sur l'extension et non sur leur position, qui varie selon le mode de lancement ;
- les logs du main sont écrits dans `<userData>/logs/quark.log` (`Logger.enableFileLogging`) : une application packagée n'a pas de console, et sans ce fichier un incident chez un utilisateur ne laisse aucune trace.

### Stored Procedures (MSSQL / Azure)

Le driver MSSQL expose des méthodes pour lister, détailler, exécuter, modifier et supprimer les procédures stockées via `tedious`. Les routes sont exposées dans `DbController` (`db/stored-procedures`, `db/stored-procedure-detail`, `db/stored-procedure-exec`, `db/stored-procedure-modify`, `db/stored-procedure-drop`). Côté renderer, `StoredProceduresService` gère l'état et la communication ; la sidebar affiche une section « Stored Procedures » conditionnelle (basée sur `DriverCapabilities.storedProcedures`). La page dédiée (`views/dashboard/stored-procedure/`) intègre un éditeur Monaco pour la définition et un formulaire dynamique pour les paramètres d'entrée.

## Build & Dev

```bash
npm run dev                 # build main (dev) + lance Electron (source maps activées)
npm run build               # build main (prod) + build renderer (prod)
npm run typecheck           # tsc --noEmit (main + shared + specs)
npm run typecheck:renderer  # tsc --noEmit du renderer
npm run lint                # biome lint . (main, scripts, shared, renderer)
npm test                    # vitest, sous le Node d'Electron
npm run make                # electron-builder → installeur distributable
```

> Lancé depuis un terminal intégré de VS Code, `ELECTRON_RUN_AS_NODE=1` peut être hérité : Electron démarre alors comme Node et échoue sur `electron/main`. Il faut retirer la variable (`env -u ELECTRON_RUN_AS_NODE npm start`).

> En développement, le renderer est chargé depuis le serveur Angular sur `localhost:4200`. En production, depuis `dist/browser/`.

### Packaging (electron-builder)

`electron-builder.config.js` reste déclaratif ; la logique vit dans `main/scripts/` :

| Fichier | Rôle |
| --- | --- |
| `package-files.js` | Patterns `files` : exclusion des artefacts de build (sourcemaps, sources C/C++ et résidus node-gyp, sources TS, docs) et des binaires natifs des autres plateformes |
| `resolve-native-modules.js` | Globs `asarUnpack`, détectés sur la présence réelle d'un `.node` dans les dépendances de production |
| `flip-fuses.js` | Verrouillage des fuses Electron en `afterPack` : ni mode Node, ni `NODE_OPTIONS`, ni inspecteur ; intégrité de l'asar vérifiée (Windows) et chargement depuis l'asar uniquement |

Deux pièges à ne pas réintroduire :

- **Tous les patterns `files` tiennent dans le tableau racine.** electron-builder normalise `config.files` en `[{ filter: [...] }]` (un matcher dédié) alors que des `files` déclarés sous `win`/`linux` alimentent un second matcher qui passe en tête. Ce dernier ne contenant que des exclusions, electron-builder lui ajoute `**/*` et embarque le projet entier (`renderer/.angular`, `main/`, `.vscode`…) dans l'asar.
- **Les binaires natifs conservés sont ceux de la machine de build**, pas ceux de la cible : `electron-rebuild` ne compile que pour l'hôte, un paquet Linux produit depuis Windows n'est de toute façon pas fonctionnel.

`@libsql/client` tire le module natif `libsql` et son binaire par plateforme (`@libsql/<plateforme>-<arch>`, ~9 Mo) : Quark n'utilisant que `@libsql/client/web`, ils sont exclus des `files` (`UNUSED_PACKAGE_EXCLUSIONS`). Les tests, eux, s'en servent pour ouvrir une base libSQL en mémoire.

`electronLanguages` limite Chromium à `en-US` et `fr` : les 53 autres `.pak` pèsent 45 Mo. De même, `angular.json` (`ignore` de l'asset Monaco) n'embarque que les traductions anglaise (défaut) et française de Monaco (~1,7 Mo de moins). À élargir en même temps que `renderer/src/app/core/i18n/`.

L'icône de l'application (`renderer/public/favicon.ico`, multi-tailles 16–256 px, et `app-logo/app-logo-fill-512.png` pour Linux) sert aussi à l'installeur et au désinstallateur NSIS (`installerIcon`, `uninstallerIcon`, `installerHeaderIcon`). Windows produit un installeur `*-Setup.exe` et une version portable `*-Portable.exe` ; la release échoue si l'un des deux manque.

### Sécurité du renderer

`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`. Le preload est bundlé avec Noxus (`noExternal` dans `tsup.config.cjs`) : un preload sandboxé ne peut `require` que les modules d'Electron.

## Conventions — Main (Node.js / Noxus)

- **Path alias** : `src/*` → `main/src/*`, `@shared/*` → `shared/*`
- `inject()` pour l'injection de dépendances (pas de constructeur DI)
- Les services singleton (un par app) : `lifetime: "singleton"` ; par onglet/connexion : `lifetime: "transient"`
- Les `BrowserWindow` sont gérées uniquement via la classe `Window` (`main/src/core/services/window.ts`)
- Toujours utiliser `Logger` de Noxus, jamais `console.log`
- Nouvelle opération IPC : une route dans un contrôleur Noxus (`GET` pour une lecture, `POST` pour une mutation), la méthode correspondante dans `IpcRendererBridge` et sa ligne dans `noxus-ipc.bridge.ts`. Jamais de `ipcMain.handle`.
- La fenêtre appelante se retrouve par `Application.requireWindow(request.senderId)`.

## Conventions — Renderer (Angular 21)

- **Tous** les composants sont `standalone: true` avec `ChangeDetectionStrategy.OnPush`
- Injection systématique via `inject()` ; **aucun** constructeur avec paramètres injectés
- État local via **signals** : `signal()`, `computed()`, `input()`, `model()`
- Subscriptions RxJS : étendre `SubscriptionManager` et utiliser `this.watch$ = observable` (pas de `.subscribe()` manuel)
- Pages : fichiers `*.page.ts/.html/.scss` dans `views/<feature>/`
- **Sélecteurs** : composants app → `app-*` ; composants UI partagés → `ui-*`
- Path aliases : `@shared/*` → `shared/*`, `@ui/*` → `renderer/src/app/shared/ui/components/*`

### Système de design

L'interface suit la maquette `Quark.html` (Claude Design) : accent violet, Segoe UI 13 px, Fira Code pour le code, les types et les valeurs non textuelles. Toutes les couleurs passent par les tokens de `renderer/src/theme/variables.scss` (`--bg-*`, `--border-*`, `--text-*`, `--accent*`, `--danger*`, `--success*`, `--warning*` pour la transaction, `--pk-*` / `--fk-*`, `--syntax-*`, `--shadow-*`, `--radius-*`, `--tint-<driver>`), définis pour les thèmes clair, sombre, minuit et système. **Aucune couleur en dur** dans les composants. Les anciens noms (`--surface*`, `--interactive*`, `--color-*`…) restent des alias et ne doivent plus être utilisés dans du nouveau code. Classes globales (`common.scss`) : `.section-title`, `.key-badge.pk|.fk`, `.kbd`, `.mono`, case à cocher native stylée.

Les réglages de la page Paramètres propres au renderer (mode édition au démarrage, confirmation des suppressions, transaction automatique, timestamps en date, densité de la grille, SSL par défaut, délai de connexion) sont dans `SettingsService` (`localStorage`, clé `quark-settings`).

### Composants UI (`shared/ui/`)

Tous les composants UI étendent `UIComponent` (directive abstraite). Instanciation dynamique via des contrôleurs (`AlertController`, `ModalController`) avec `controller.create(config)`. Couleurs disponibles : `UIColor` (`primary`, `secondary`, `danger`, `success`, `warning`…) et `ExtendedUIColor` (`transparent`, `*-gradient`, `windows-*`).

La pipe `bypass` contourne la sanitisation Angular (`bypass:'html'|'style'`) — à utiliser uniquement pour du contenu interne maîtrisé.

## Linting (Biome)

- Biome sert de **linter** (règles `recommended` et quelques règles de style du repo, voir `biome.json`) sur `main/`, `shared/`, `renderer/src` et les scripts. Le **formatter est désactivé** : il ne sait pas produire le style Stroustrup (`else` sur la ligne qui suit l'accolade fermante) exigé par les conventions.
- Indentation : **4 espaces**, ligne max : **120 caractères**, **doubles quotes**
- Lancer `npm run lint` avant tout commit (la CI échoue sinon)

## Tests (vitest)

- Fichiers `*.spec.ts` à côté du code testé, dans `main/src` ou `renderer/src` (côté renderer, code pur uniquement). Configuration : `vitest.config.mts`.
- `npm test` exécute vitest sous le Node embarqué d'Electron : `better-sqlite3-multiple-ciphers` est compilé pour l'ABI d'Electron par `electron-rebuild`.
- Les drivers réseau n'ont pas de tests : il faudrait des serveurs de base de données. Le driver SQLite, le driver libSQL (client complet sur une base `:memory:`, injecté par le constructeur), l'hôte des drivers (test de connexion compris), les cibles de connexion, le diff de session, le coffre (dossiers, rétro-compatibilité, mot de passe maître), les mots de passe mémorisés, les versions et le bridge IPC sont couverts.
- `safeStorage` est isolé derrière `SystemKeychain` (`system-keychain.types.ts`) : les tests passent un trousseau factice. Un service qui importe `@noxfly/noxus/main` charge tout Electron : le spec mocke alors ce module (Logger seul).

## Licence et en-têtes

Chaque fichier source commence par l'en-tête AGPL bilingue de NoxFly (à copier depuis un fichier existant) :

```ts
/*
 * Quark
 * Copyright (C) 2026 NoxFly
 * ...
 * SPDX-License-Identifier: AGPL-3.0-only
 */
```

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

- All files must include the NoxFly AGPL-3.0-only header (see "Licence et en-têtes")
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
