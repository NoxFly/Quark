/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

export type { DatabaseDriver } from "src/core/drivers/driver.interface";
export { SqliteDriver } from "src/core/drivers/sqlite.driver";
export { createDriver, getDriverInfo, getDriverCategory, getAllDriverInfos } from "src/core/drivers/driver-registry";
