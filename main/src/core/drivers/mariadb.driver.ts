/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import type { DatabaseDriverType } from "@shared/driver";
import { MysqlDriver } from "src/core/drivers/mysql.driver";

/**
 * Driver MariaDB.
 * MariaDB est compatible MySQL au niveau protocole/SQL,
 * ce driver hérite donc de MysqlDriver et ne remplace que l'identité.
 */
export class MariadbDriver extends MysqlDriver {
    public override readonly driverType: DatabaseDriverType = "mariadb";
}
