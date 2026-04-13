/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

/**
 * French translations.
 */
export const fr: Record<string, string> = {
    // --- Titlebar menus ---
    "menu.file": "Fichier",
    "menu.open": "Ouvrir...",
    "menu.newWindow": "Nouvelle fenêtre",
    "menu.refresh": "Rafraîchir",
    "menu.closeFile": "Fermer le fichier",
    "menu.quit": "Quitter",
    "menu.edit": "Édition",
    "menu.startTransaction": "Démarrer une transaction",
    "menu.commitTransaction": "Valider la transaction",
    "menu.rollbackTransaction": "Annuler la transaction",
    "menu.deleteSelection": "Supprimer la sélection",
    "menu.view": "Affichage",
    "menu.fullscreen": "Plein écran",
    "menu.changeTheme": "Changer le thème",
    "menu.language": "Langue",
    "menu.export": "Exporter",
    "menu.exportJson": "Exporter en JSON",
    "menu.exportCsv": "Exporter en CSV",
    "menu.help": "Aide",
    "menu.about": "À propos",

    // --- Open database ---
    "openDb.encrypted": "Base de données chiffrée",
    "openDb.enterPassword": "Entrez le mot de passe pour déverrouiller la base de données.",
    "openDb.password": "Mot de passe",
    "openDb.unlock": "Déverrouiller",
    "openDb.wrongPassword": "Mot de passe incorrect ou base corrompue.",
    "openDb.title": "Ouvrir une base de données SQLite",
    "openDb.dropHint": "Cliquez ici ou glissez-déposez un fichier",

    // --- Sidebar ---
    "sidebar.refresh.tooltip": "Rafraîchir la base",
    "sidebar.close.tooltip": "Fermer la base",
    "sidebar.rows.tooltip": "{count} lignes",
    "sidebar.refresh": "Rafraîchir",
    "sidebar.close": "Fermer",

    // --- Table data ---
    "table.transactionActive": "Mode Transaction actif",
    "table.commit": "Valider",
    "table.cancel": "Annuler",
    "table.filterPlaceholder": "Filtrer... ex: id = 1 and name like '%abc%'",
    "table.newRecord": "Nouvel enregistrement",
    "table.loading": "Chargement...",
    "table.ctrlClickFk": "Ctrl+Clic pour naviguer vers {table}.{column}",

    // --- Context menu ---
    "contextMenu.edit": "Modifier l'enregistrement",
    "contextMenu.duplicate": "Dupliquer l'enregistrement",
    "contextMenu.new": "Nouvel enregistrement",
    "contextMenu.delete": "Supprimer l'enregistrement",

    // --- Record editor ---
    "editor.createTitle": "Nouvel enregistrement",
    "editor.editTitle": "Modifier l'enregistrement",
    "editor.duplicateTitle": "Dupliquer l'enregistrement",
    "editor.cancel": "Annuler",
    "editor.save": "Enregistrer",
    "editor.saving": "Enregistrement...",

    // --- Statusbar ---
    "statusbar.rows": "{loaded} / {total} lignes",
    "statusbar.selected": "{count} sélectionnée(s)",
    "statusbar.transaction": "Transaction active",

    // --- No table ---
    "noTable.title": "Sélectionnez une table",
    "noTable.hint": "Choisissez une table dans le menu de gauche pour afficher ses données.",
    "noTable.tableCount": "{count} table(s) disponible(s)",

    "short.new": "Nouveau",
};
