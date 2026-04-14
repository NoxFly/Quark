/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

/**
 * English translations (default locale).
 */
export const en: Record<string, string> = {
    // --- Titlebar menus ---
    "menu.file": "File",
    "menu.open": "Open",
    "menu.newWindow": "New window",
    "menu.refresh": "Refresh",
    "menu.closeFile": "Close file",
    "menu.quit": "Quit",
    "menu.edit": "Edit",
    "menu.undo": "Undo",
    "menu.redo": "Redo",
    "menu.toggleEditMode": "Toggle edit mode",
    "menu.startTransaction": "Start transaction",
    "menu.commitTransaction": "Commit transaction",
    "menu.rollbackTransaction": "Rollback transaction",
    "menu.transactionDiff": "View pending changes",
    "menu.deleteSelection": "Delete selection",
    "menu.importData": "Import data",
    "menu.view": "View",
    "menu.sqlEditor": "SQL Editor",
    "menu.erDiagram": "ER Diagram",
    "menu.fullscreen": "Fullscreen",
    "menu.changeTheme": "Change theme",
    "menu.language": "Language",
    "menu.export": "Export",
    "menu.exportJson": "Export as JSON",
    "menu.exportCsv": "Export as CSV",
    "menu.database": "Database",
    "menu.schemaEditor": "Edit table schema",
    "menu.createTable": "Create table",
    "menu.indexViewer": "View indexes",
    "menu.changePassword": "Change encryption",
    "menu.viewSchema": "View database schema",
    "menu.dropTable": "Delete table",
    "menu.help": "Help",
    "menu.about": "About",
    "menu.shortcuts": "Shortcuts",

    // --- Open database ---
    "openDb.encrypted": "Encrypted database",
    "openDb.enterPassword": "Enter the password to unlock the database.",
    "openDb.password": "Password",
    "openDb.unlock": "Unlock",
    "openDb.wrongPassword": "Incorrect password or corrupted database.",
    "openDb.title": "Open a SQLite database",
    "openDb.dropHint": "Click here or drag and drop a file",

    // --- Sidebar ---
    "sidebar.refresh.tooltip": "Refresh database",
    "sidebar.close.tooltip": "Close database",
    "sidebar.rows": "{count} rows",
    "sidebar.refresh": "Refresh",
    "sidebar.close": "Close",
    "sidebar.createTable": "Create table",
    "sidebar.createTable.tooltip": "Create a new table",
    "sidebar.schemaEditor": "Edit schema",
    "sidebar.schemaEditor.tooltip": "Edit the current table schema",
    "sidebar.indexViewer": "Indexes",
    "sidebar.indexViewer.tooltip": "View and manage indexes",
    "sidebar.changePassword": "Encryption",
    "sidebar.changePassword.tooltip": "Change database encryption",


    // --- Table data ---
    "table.transactionActive": "Transaction mode active",
    "table.commit": "Commit",
    "table.cancel": "Cancel",
    "table.filterPlaceholder": "Filter... e.g. id = 1 and name like '%abc%'",
    "table.searchPlaceholder": "Search...",
    "table.switchToSqlite": "Switch to SQLite filter mode",
    "table.switchToSearch": "Switch to full-text search mode",
    "table.newRecord": "New record",
    "table.loading": "Loading...",
    "table.ctrlClickFk": "Ctrl+Click to navigate to {table}.{column}",
    "table.switchToEdit": "Switch to edit mode (Ctrl+E)",
    "table.switchToReadOnly": "Switch to read-only mode (Ctrl+E)",
    "table.selectAll": "Select all rows",
    "table.toggleTimestamp": "Toggle date display",

    // --- Context menu ---
    "contextMenu.edit": "Edit record",
    "contextMenu.duplicate": "Duplicate record",
    "contextMenu.new": "New record",
    "contextMenu.delete": "Delete record",
    "contextMenu.deleteSelection": "Delete selection",
    "contextMenu.copyJson": "Copy as JSON",
    "contextMenu.batchEdit": "Edit selected field...",
    "contextMenu.importData": "Import data...",
    "contextMenu.schemaEditor": "Edit schema...",
    "contextMenu.indexViewer": "View indexes...",

    // --- Record editor ---
    "editor.createTitle": "New record",
    "editor.editTitle": "Edit record",
    "editor.duplicateTitle": "Duplicate record",
    "editor.cancel": "Cancel",
    "editor.save": "Save",
    "editor.saving": "Saving...",

    // --- Statusbar ---
    "statusbar.rows": "{loaded} / {total} rows",
    "statusbar.selected": "{count} selected",
    "statusbar.transaction": "Active transaction",
    "statusbar.readOnly": "Read-only",
    "statusbar.readWrite": "Edit",
    "statusbar.sqlEditor": "SQL Editor",
    "statusbar.sqlEditorOpen": "Switch to SQL Editor",
    "statusbar.sqlEditorClose": "Back to table view",

    // --- No table ---
    "noTable.title": "Select a table",
    "noTable.hint": "Choose a table from the left panel to view its data.",
    "noTable.tableCount": "{count} table(s) available",

    // --- SQL Editor ---
    "sqlEditor.title": "SQL Editor",
    "sqlEditor.execute": "Execute",
    "sqlEditor.executing": "Executing...",
    "sqlEditor.clear": "Clear",
    "sqlEditor.placeholder": "Enter SQL query...",
    "sqlEditor.hint": "Ctrl+Enter to execute  •  Ctrl+↑/↓ for history",
    "sqlEditor.rowCount": "{count} rows",
    "sqlEditor.rowsAffected": "{count} rows affected",
    "sqlEditor.lastInsertId": "Last insert ID: {id}",
    "sqlEditor.emptyHint": "Execute a query to see results",
    "sqlEditor.history": "Query history",
    "sqlEditor.truncated": "(showing first {shown})",

    // --- ER Diagram ---
    "erDiagram.noTables": "No tables found in the database.",

    // --- Batch edit ---
    "batchEdit.title": "Batch edit",
    "batchEdit.subtitle": "{count} rows selected",
    "batchEdit.column": "Column",
    "batchEdit.value": "New value",
    "batchEdit.valuePlaceholder": "Enter new value...",
    "batchEdit.setNull": "Set to NULL",
    "batchEdit.apply": "Apply to all",

    // --- Import data ---
    "importData.title": "Import data",
    "importData.table": "Target table: {table}",
    "importData.format": "Format",
    "importData.mode": "Mode",
    "importData.modeInsert": "Insert",
    "importData.modeUpsert": "Insert or Replace",
    "importData.file": "File",
    "importData.orPaste": "Or paste data",
    "importData.pastePlaceholder": "Paste CSV or JSON data here...",
    "importData.parsing": "Parsing...",
    "importData.preview": "Preview",
    "importData.previewMeta": "Showing {shown} of {total} rows",
    "importData.back": "Back",
    "importData.importing": "Importing...",
    "importData.confirm": "Import {count} rows",
    "importData.success": "{count} rows imported successfully",
    "importData.done": "Done",

    // --- Schema editor ---
    "schemaEditor.title": "Schema editor",
    "schemaEditor.tableName": "Table name",
    "schemaEditor.columns": "Columns",
    "schemaEditor.addColumn": "Add column",
    "schemaEditor.colName": "Name",
    "schemaEditor.defaultValue": "Default value",
    "schemaEditor.dropColumn": "Mark for deletion",
    "schemaEditor.cancelDrop": "Cancel deletion",
    "schemaEditor.pendingChanges": "Pending changes",
    "schemaEditor.apply": "Apply changes",

    // --- Create table ---
    "createTable.title": "Create new table",
    "createTable.tableName": "Table name",
    "createTable.tableNamePlaceholder": "Enter table name...",
    "createTable.columns": "Columns",
    "createTable.addColumn": "Add column",
    "createTable.colName": "Name",
    "createTable.colType": "Type",
    "createTable.colDefault": "Default",
    "createTable.colNamePlaceholder": "column_name",
    "createTable.defaultPlaceholder": "e.g. 0 or 'text'",
    "createTable.sqlPreview": "SQL Preview",
    "createTable.create": "Create table",

    // --- Index viewer ---
    "indexViewer.title": "Indexes",
    "indexViewer.noIndexes": "No indexes on this table.",
    "indexViewer.drop": "Drop",
    "indexViewer.createIndex": "Create new index",
    "indexViewer.indexName": "Index name",
    "indexViewer.indexNamePlaceholder": "idx_tablename_column",
    "indexViewer.selectColumns": "Columns",
    "indexViewer.create": "Create index",
    "indexViewer.close": "Close",

    // --- Change password ---
    "changePassword.title": "Change encryption",
    "changePassword.modeSet": "Set / change password",
    "changePassword.modeRemove": "Remove encryption",
    "changePassword.newPassword": "New password",
    "changePassword.passwordPlaceholder": "Enter new password...",
    "changePassword.confirmPassword": "Confirm password",
    "changePassword.confirmPlaceholder": "Confirm password...",
    "changePassword.mismatch": "Passwords do not match",
    "changePassword.removeWarning": "This will decrypt the database and save it without encryption.",
    "changePassword.apply": "Apply",
    "changePassword.changedSuccess": "Password changed successfully.",
    "changePassword.removedSuccess": "Encryption removed successfully.",

    // --- Transaction diff ---
    "transactionDiff.title": "Transaction changes",
    "transactionDiff.subtitle": "{count} change(s) pending",
    "transactionDiff.noChanges": "No changes recorded yet.",
    "transactionDiff.inserted": "New row inserted",
    "transactionDiff.deleted": "Row deleted",

    // --- Tabs bar ---
    "tabs.close": "Close tab",
    "tabs.closeAll": "Close all tabs",
    "tabs.closeOthers": "Close other tabs",

    // --- Sidebar table context menu ---
    "sidebar.table.schemaEditor": "Edit table schema",
    "sidebar.table.indexViewer": "View indexes",
    "sidebar.table.deleteTable": "Delete table",

    // --- Database schema viewer ---
    "schemaViewer.title": "Database schema",
    "schemaViewer.copyAll": "Copy all",
    "schemaViewer.export": "Export SQL",
    "schemaViewer.close": "Close",
    "schemaViewer.copied": "Copied!",

    // --- Confirm delete table ---
    "confirmDelete.table.title": "Delete table",
    "confirmDelete.table.message": "Are you sure you want to delete the table \"{table}\"? This action is irreversible.",
    "confirmDelete.confirm": "Delete",
    "confirmDelete.cancel": "Cancel",

    "short.new": "New",

    // --- Recent databases ---
    "recentDb.title": "Recent databases",
    "recentDb.empty": "No recent databases.",

    // --- Shortcuts ---
    "shortcuts.title": "Keyboard shortcuts",
    "shortcuts.close": "Close",
    "shortcuts.group.file": "File",
    "shortcuts.group.edit": "Edit",
    "shortcuts.group.view": "View",
    "shortcuts.group.tabs": "Tabs",
    "shortcuts.group.sqlEditor": "SQL Editor",
    "shortcuts.open": "Open database",
    "shortcuts.newWindow": "New window",
    "shortcuts.closeFile": "Close file",
    "shortcuts.refreshDb": "Refresh database",
    "shortcuts.recentDb": "Recent databases",
    "shortcuts.reload": "Reload window",
    "shortcuts.quit": "Quit",
    "shortcuts.toggleEditMode": "Toggle edit mode",
    "shortcuts.startTransaction": "Start transaction",
    "shortcuts.undo": "Undo",
    "shortcuts.redo": "Redo",
    "shortcuts.sqlEditor": "Open SQL editor",
    "shortcuts.fullscreen": "Toggle fullscreen",
    "shortcuts.changeTheme": "Change theme",
    "shortcuts.closeTab": "Close active tab",
    "shortcuts.executeSql": "Execute query",
    "shortcuts.sqlHistory": "Navigate query history",
};
