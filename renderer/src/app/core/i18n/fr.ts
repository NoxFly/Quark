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
    "menu.open": "Ouvrir",
    "menu.newWindow": "Nouvelle fenêtre",
    "menu.refresh": "Rafraîchir",
    "menu.closeFile": "Fermer le fichier",
    "menu.quit": "Quitter",
    "menu.edit": "Édition",
    "menu.undo": "Annuler",
    "menu.redo": "Rétablir",
    "menu.toggleEditMode": "Basculer le mode édition",
    "menu.startTransaction": "Démarrer une transaction",
    "menu.commitTransaction": "Valider la transaction",
    "menu.rollbackTransaction": "Annuler la transaction",
    "menu.transactionDiff": "Voir les modifications en attente",
    "menu.deleteSelection": "Supprimer la sélection",
    "menu.importData": "Importer des données",
    "menu.view": "Affichage",
    "menu.sqlEditor": "Éditeur SQL",
    "menu.erDiagram": "Diagramme ER",
    "menu.fullscreen": "Plein écran",
    "menu.changeTheme": "Changer le thème",
    "menu.language": "Langue",
    "menu.export": "Exporter",
    "menu.exportJson": "Exporter en JSON",
    "menu.exportCsv": "Exporter en CSV",
    "menu.database": "Base de données",
    "menu.schemaEditor": "Modifier le schéma de la table",
    "menu.createTable": "Créer une table",
    "menu.indexViewer": "Voir les index",
    "menu.changePassword": "Chiffrement",
    "menu.viewSchema": "Voir le schéma de la base",
    "menu.dropTable": "Supprimer la table",
    "menu.help": "Aide",
    "menu.about": "À propos",
    "menu.shortcuts": "Raccourcis",

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
    "sidebar.createTable": "Créer une table",
    "sidebar.createTable.tooltip": "Créer une nouvelle table",
    "sidebar.schemaEditor": "Modifier le schéma",
    "sidebar.schemaEditor.tooltip": "Modifier le schéma de la table active",
    "sidebar.indexViewer": "Index",
    "sidebar.indexViewer.tooltip": "Voir et gérer les index",
    "sidebar.changePassword": "Chiffrement",
    "sidebar.changePassword.tooltip": "Modifier le chiffrement de la base",

    // --- Table data ---
    "table.transactionActive": "Mode Transaction actif",
    "table.commit": "Valider",
    "table.cancel": "Annuler",
    "table.filterPlaceholder": "Filtrer... ex: id = 1 and name like '%abc%'",
    "table.searchPlaceholder": "Rechercher...",
    "table.switchToSqlite": "Passer en mode filtre SQLite",
    "table.switchToSearch": "Passer en mode recherche texte",
    "table.newRecord": "Nouvel enregistrement",
    "table.loading": "Chargement...",
    "table.ctrlClickFk": "Ctrl+Clic pour naviguer vers {table}.{column}",
    "table.switchToEdit": "Passer en mode édition (Ctrl+E)",
    "table.switchToReadOnly": "Passer en mode lecture seule (Ctrl+E)",
    "table.selectAll": "Sélectionner toutes les lignes",
    "table.toggleTimestamp": "Afficher/masquer la date",

    // --- Context menu ---
    "contextMenu.edit": "Modifier l'enregistrement",
    "contextMenu.duplicate": "Dupliquer l'enregistrement",
    "contextMenu.new": "Nouvel enregistrement",
    "contextMenu.delete": "Supprimer l'enregistrement",
    "contextMenu.deleteSelection": "Supprimer la sélection",
    "contextMenu.copyJson": "Copier au format JSON",
    "contextMenu.batchEdit": "Modifier le champ sélectionné...",
    "contextMenu.importData": "Importer des données...",
    "contextMenu.schemaEditor": "Modifier le schéma...",
    "contextMenu.indexViewer": "Voir les index...",

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
    "statusbar.readOnly": "Lecture seule",
    "statusbar.readWrite": "Édition",

    // --- No table ---
    "noTable.title": "Sélectionnez une table",
    "noTable.hint": "Choisissez une table dans le menu de gauche pour afficher ses données.",
    "noTable.tableCount": "{count} table(s) disponible(s)",

    // --- SQL Editor ---
    "sqlEditor.title": "Éditeur SQL",
    "sqlEditor.execute": "Exécuter",
    "sqlEditor.executing": "Exécution...",
    "sqlEditor.clear": "Effacer",
    "sqlEditor.placeholder": "Entrez une requête SQL...",
    "sqlEditor.hint": "Ctrl+Entrée pour exécuter  •  Ctrl+↑/↓ pour l'historique",
    "sqlEditor.rowCount": "{count} lignes",
    "sqlEditor.rowsAffected": "{count} ligne(s) affectée(s)",
    "sqlEditor.lastInsertId": "Dernier ID inséré : {id}",
    "sqlEditor.emptyHint": "Exécutez une requête pour voir les résultats",
    "sqlEditor.history": "Historique des requêtes",
    "sqlEditor.truncated": "(affichage des {shown} premiers)",

    // --- ER Diagram ---
    "erDiagram.noTables": "Aucune table trouvée dans la base de données.",

    // --- Batch edit ---
    "batchEdit.title": "Édition par lot",
    "batchEdit.subtitle": "{count} ligne(s) sélectionnée(s)",
    "batchEdit.column": "Colonne",
    "batchEdit.value": "Nouvelle valeur",
    "batchEdit.valuePlaceholder": "Entrez la nouvelle valeur...",
    "batchEdit.setNull": "Définir à NULL",
    "batchEdit.apply": "Appliquer à toutes",

    // --- Import data ---
    "importData.title": "Importer des données",
    "importData.table": "Table cible : {table}",
    "importData.format": "Format",
    "importData.mode": "Mode",
    "importData.modeInsert": "Insérer",
    "importData.modeUpsert": "Insérer ou remplacer",
    "importData.file": "Fichier",
    "importData.orPaste": "Ou coller les données",
    "importData.pastePlaceholder": "Collez ici vos données CSV ou JSON...",
    "importData.parsing": "Analyse en cours...",
    "importData.preview": "Aperçu",
    "importData.previewMeta": "Affichage de {shown} sur {total} ligne(s)",
    "importData.back": "Retour",
    "importData.importing": "Importation...",
    "importData.confirm": "Importer {count} ligne(s)",
    "importData.success": "{count} ligne(s) importée(s) avec succès",
    "importData.done": "Terminé",

    // --- Schema editor ---
    "schemaEditor.title": "Éditeur de schéma",
    "schemaEditor.tableName": "Nom de la table",
    "schemaEditor.columns": "Colonnes",
    "schemaEditor.addColumn": "Ajouter une colonne",
    "schemaEditor.colName": "Nom",
    "schemaEditor.defaultValue": "Valeur par défaut",
    "schemaEditor.dropColumn": "Marquer pour suppression",
    "schemaEditor.cancelDrop": "Annuler la suppression",
    "schemaEditor.pendingChanges": "Modifications en attente",
    "schemaEditor.apply": "Appliquer les modifications",

    // --- Create table ---
    "createTable.title": "Créer une nouvelle table",
    "createTable.tableName": "Nom de la table",
    "createTable.tableNamePlaceholder": "Entrez le nom de la table...",
    "createTable.columns": "Colonnes",
    "createTable.addColumn": "Ajouter une colonne",
    "createTable.colName": "Nom",
    "createTable.colType": "Type",
    "createTable.colDefault": "Défaut",
    "createTable.colNamePlaceholder": "nom_colonne",
    "createTable.defaultPlaceholder": "ex : 0 ou 'texte'",
    "createTable.sqlPreview": "Aperçu SQL",
    "createTable.create": "Créer la table",

    // --- Index viewer ---
    "indexViewer.title": "Index",
    "indexViewer.noIndexes": "Aucun index sur cette table.",
    "indexViewer.drop": "Supprimer",
    "indexViewer.createIndex": "Créer un nouvel index",
    "indexViewer.indexName": "Nom de l'index",
    "indexViewer.indexNamePlaceholder": "idx_table_colonne",
    "indexViewer.selectColumns": "Colonnes",
    "indexViewer.create": "Créer l'index",
    "indexViewer.close": "Fermer",

    // --- Change password ---
    "changePassword.title": "Chiffrement",
    "changePassword.modeSet": "Définir / changer le mot de passe",
    "changePassword.modeRemove": "Supprimer le chiffrement",
    "changePassword.newPassword": "Nouveau mot de passe",
    "changePassword.passwordPlaceholder": "Entrez le nouveau mot de passe...",
    "changePassword.confirmPassword": "Confirmer le mot de passe",
    "changePassword.confirmPlaceholder": "Confirmez le mot de passe...",
    "changePassword.mismatch": "Les mots de passe ne correspondent pas",
    "changePassword.removeWarning": "Cela déchiffrera la base et la sauvegardera sans chiffrement.",
    "changePassword.apply": "Appliquer",
    "changePassword.changedSuccess": "Mot de passe modifié avec succès.",
    "changePassword.removedSuccess": "Chiffrement supprimé avec succès.",

    // --- Transaction diff ---
    "transactionDiff.title": "Modifications de la transaction",
    "transactionDiff.subtitle": "{count} modification(s) en attente",
    "transactionDiff.noChanges": "Aucune modification enregistrée.",
    "transactionDiff.inserted": "Nouvelle ligne insérée",
    "transactionDiff.deleted": "Ligne supprimée",

    // --- Tabs bar ---
    "tabs.close": "Fermer l'onglet",
    "tabs.closeAll": "Fermer tous les onglets",
    "tabs.closeOthers": "Fermer les autres onglets",

    // --- Sidebar table context menu ---
    "sidebar.table.schemaEditor": "Modifier le schéma de la table",
    "sidebar.table.indexViewer": "Voir les index",
    "sidebar.table.deleteTable": "Supprimer la table",

    // --- Database schema viewer ---
    "schemaViewer.title": "Schéma de la base",
    "schemaViewer.copyAll": "Tout copier",
    "schemaViewer.export": "Exporter en SQL",
    "schemaViewer.close": "Fermer",
    "schemaViewer.copied": "Copié !",

    // --- Confirm delete table ---
    "confirmDelete.table.title": "Supprimer la table",
    "confirmDelete.table.message": "Voulez-vous vraiment supprimer la table \"{table}\" ? Cette action est irréversible.",
    "confirmDelete.confirm": "Supprimer",
    "confirmDelete.cancel": "Annuler",

    "short.new": "Nouveau",

    // --- Recent databases ---
    "recentDb.title": "Bases de données récentes",
    "recentDb.empty": "Aucune base récente.",

    // --- Shortcuts ---
    "shortcuts.title": "Raccourcis clavier",
    "shortcuts.close": "Fermer",
    "shortcuts.group.file": "Fichier",
    "shortcuts.group.edit": "Édition",
    "shortcuts.group.view": "Affichage",
    "shortcuts.group.tabs": "Onglets",
    "shortcuts.group.sqlEditor": "Éditeur SQL",
    "shortcuts.open": "Ouvrir une base",
    "shortcuts.newWindow": "Nouvelle fenêtre",
    "shortcuts.closeFile": "Fermer le fichier",
    "shortcuts.refreshDb": "Rafraîchir la base",
    "shortcuts.recentDb": "Bases récentes",
    "shortcuts.reload": "Recharger la fenêtre",
    "shortcuts.quit": "Quitter",
    "shortcuts.toggleEditMode": "Basculer le mode édition",
    "shortcuts.startTransaction": "Démarrer une transaction",
    "shortcuts.undo": "Annuler",
    "shortcuts.redo": "Rétablir",
    "shortcuts.sqlEditor": "Ouvrir l'éditeur SQL",
    "shortcuts.fullscreen": "Basculer le plein écran",
    "shortcuts.changeTheme": "Changer le thème",
    "shortcuts.closeTab": "Fermer l'onglet actif",
    "shortcuts.executeSql": "Exécuter la requête",
    "shortcuts.sqlHistory": "Naviguer dans l'historique",
};
