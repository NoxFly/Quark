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
    "menu.open": "Open...",
    "menu.newWindow": "New window",
    "menu.refresh": "Refresh",
    "menu.closeFile": "Close file",
    "menu.quit": "Quit",
    "menu.edit": "Edit",
    "menu.toggleEditMode": "Toggle edit mode",
    "menu.startTransaction": "Start transaction",
    "menu.commitTransaction": "Commit transaction",
    "menu.rollbackTransaction": "Rollback transaction",
    "menu.deleteSelection": "Delete selection",
    "menu.view": "View",
    "menu.fullscreen": "Fullscreen",
    "menu.changeTheme": "Change theme",
    "menu.language": "Language",
    "menu.export": "Export",
    "menu.exportJson": "Export as JSON",
    "menu.exportCsv": "Export as CSV",
    "menu.help": "Help",
    "menu.about": "About",

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

    // --- No table ---
    "noTable.title": "Select a table",
    "noTable.hint": "Choose a table from the left panel to view its data.",
    "noTable.tableCount": "{count} table(s) available",

    "short.new": "New",
};
