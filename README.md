<p align="center">
  <img src="renderer/public/images/logo-quark.png" alt="Quark" width="96" height="96">
</p>

<h1 align="center">Quark</h1>

<p align="center">Database editor for Windows and Linux — SQLite, MariaDB/MySQL, PostgreSQL, Oracle, SQL Server, Azure SQL and MongoDB.</p>

This document is a guide for the **user** of the application (installation, day-to-day use). To contribute to the code, see [AGENTS.md](AGENTS.md) and the [project instructions](.github/copilot-instructions.md).

## Installation

Download the latest release from the [Releases](../../releases/latest) page.

### Windows

Two builds are published with every release:

- **`Quark-x.y.z-Setup.exe`** — regular installer. Double-click and follow the steps; you can pick the install folder. Quark then registers itself for `.db`, `.sqlite`, `.sqlite3` and `.s3db` files (double-click one of these to open it directly).
- **`Quark-x.y.z-Portable.exe`** — no installation: a single executable you can run from a USB drive or any folder of your choice. It doesn't register file associations and doesn't update itself automatically (see [Updates](#updates)).

### Linux

- **`.deb`** (Debian, Ubuntu and derivatives): `sudo apt install ./quark-x.y.z.deb`
- **`.rpm`** (Fedora, openSUSE and derivatives): `sudo dnf install ./quark-x.y.z.rpm` (or `rpm -i`)

## First launch

On startup, Quark shows a home screen to open or create a connection:

- **A SQLite file**: drag and drop it onto the window, or click the drop zone to pick one (<kbd>Ctrl</kbd>+<kbd>O</kbd>). A remotely hosted SQLite database (libSQL / Turso) opens from its URL, in the same form.
- **A network database** (MariaDB/MySQL, PostgreSQL, Oracle, SQL Server, Azure SQL, MongoDB): pick its type, fill in host, port, credentials and database, then **Connect**. The **Test** button checks the connection without opening it.
- **A recently opened database** shows up under "Recently opened".

If the database is encrypted (SQLCipher), Quark detects it automatically and asks for the password on open; check "Remember in the Windows credential vault" (or the system keychain, on Linux) so you don't have to type it again.

## Usage

### Explorer and data

The left column lists the tables of the open database. Click a table to show its data; a chevron expands its columns (type, primary key **PK**, foreign key **FK**). The field at the top filters tables by name.

Inside a table:

- the search bar filters by plain text, or by SQL (`WHERE …`) via the **SQL** toggle;
- **+ New** creates a record;
- clicking a column header sorts on it (first click ascending, second descending, third removes the sort);
- <kbd>Ctrl</kbd>+click on a foreign key value opens the referenced table, filtered on the matching row;
- <kbd>Shift</kbd>+click extends the selection to a range of rows, <kbd>Ctrl</kbd>+click extends it row by row;
- the **▦** button on a timestamp column displays it as a readable date instead of a number.

Right-clicking a table or a row opens an actions menu (edit schema, duplicate, export, truncate table, delete…).

### Read-only / edit mode

A database opens in read-only mode by default (configurable in Settings). The dedicated status bar button, or <kbd>Ctrl</kbd>+<kbd>E</kbd>, switches to edit mode so you can change a cell (click it), delete a selection, or insert a row.

### Transactions

Changes can be grouped into a transaction (<kbd>Ctrl</kbd>+<kbd>T</kbd> to start one): a banner reminds you it's open, and a colored frame surrounds the workspace. **Commit** (<kbd>Ctrl</kbd>+<kbd>Enter</kbd>) writes the changes, **Rollback** (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd>) discards them. The **Changes** page (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd>) details the diff between the database's state when it was opened and its current state, and lets you revert a single change — or every change shown — without rolling back the whole transaction.

### SQL editor

<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> opens a full SQL editor (syntax highlighting, autocompletion): <kbd>Ctrl</kbd>+<kbd>Enter</kbd> runs the query. A **History** panel recalls previous queries for that database.

### ER diagram and indexes

<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd> shows the database schema as an entity-relationship diagram (scroll to zoom, drag to pan). The **Database** menu gives access to a table's indexes, table creation and schema editing.

### Connections manager

<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> opens the connections manager: it organizes your connections into folders and tags (Production, Client, Local, Other), and keeps their credentials in an encrypted vault. On first use, set a master password (or enable protection by the system keychain, in Settings, to skip it). A connection can be exported to a passphrase-encrypted file, to share access without disclosing credentials.

### Settings

Accessible from the ⚙ icon in the title bar: language, theme (light, dark, midnight, system), edit mode on startup, confirm deletions, automatic transaction, show timestamps as dates, grid density, connection defaults (SSL by default, connection timeout, master password).

### Keyboard shortcuts

The full list is available from <kbd>Ctrl</kbd>+<kbd>/</kbd> inside the app. The main ones:

| Shortcut | Action |
| --- | --- |
| <kbd>Ctrl</kbd>+<kbd>O</kbd> | Open a file |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> | Connections manager |
| <kbd>Ctrl</kbd>+<kbd>R</kbd> | Recent databases |
| <kbd>F5</kbd> | Refresh |
| <kbd>Ctrl</kbd>+<kbd>W</kbd> | Close tab |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> | SQL editor |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd> | ER diagram |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> | Changes since opening |
| <kbd>Ctrl</kbd>+<kbd>P</kbd> | Search a table/column |
| <kbd>Ctrl</kbd>+<kbd>E</kbd> | Toggle read-only / edit |
| <kbd>Ctrl</kbd>+<kbd>N</kbd> | New record |
| <kbd>Delete</kbd> | Delete selection |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd> | Undo / Redo |
| <kbd>F11</kbd> | Fullscreen |

## Updates

The application (except the portable build) checks for updates automatically and offers to install them; this behavior is configurable in **Settings → Automatic update**. The portable build doesn't update itself: download the new version from the [Releases](../../releases/latest) page.

## Support and bug reports

To report a bug or a suggestion, open an [issue](../../issues) on the repository.

## License

Quark is distributed under the [AGPL-3.0-only](LICENSE) license.
