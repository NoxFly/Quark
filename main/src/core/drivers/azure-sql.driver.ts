/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import type { DatabaseDriverType } from "@shared/driver";
import type { AzureAuthMode } from "@shared/connection";
import { MssqlDriver } from "src/core/drivers/mssql.driver";
import type { NetworkConnectionParams } from "src/core/drivers/network-sql.driver";
import type { ConnectionAuthentication } from "tedious";

/**
 * Driver Azure SQL Database.
 *
 * Azure SQL est un service SQL Server managé : il s'accède via le même protocole
 * TDS (tedious) que SQL Server, mais impose le chiffrement TLS de la connexion.
 * Ce driver réutilise l'intégralité du `MssqlDriver` (schéma, données, procédures
 * stockées…) et ajoute deux modes d'authentification :
 * - `sql` : login / mot de passe SQL Server (défaut) ;
 * - `service-principal` : Microsoft Entra ID via un principal de service
 *   (application Azure AD) — `clientId` + `clientSecret` + `tenantId`, sans
 *   identifiant utilisateur. Le `clientSecret` transite par le champ secret de la
 *   connexion (`p.password`) ; `clientId`/`tenantId` sont fournis via `configureAuth`.
 */
export class AzureSqlDriver extends MssqlDriver {
    public override readonly driverType: DatabaseDriverType = "azure";

    private authMode: AzureAuthMode = "sql";
    private clientId = "";
    private tenantId = "";

    protected override getTlsOptions(): { encrypt: boolean; trustServerCertificate: boolean } {
        // Azure SQL exige TLS ; le certificat serveur est émis par une autorité de confiance.
        return { encrypt: true, trustServerCertificate: false };
    }

    /**
     * Configure le mode d'authentification avant l'ouverture de la connexion.
     * Doit être appelé après `setDriverType` et avant `open`.
     */
    public configureAuth(options: { mode: AzureAuthMode; clientId?: string; tenantId?: string }): void {
        this.authMode = options.mode;
        this.clientId = options.clientId ?? "";
        this.tenantId = options.tenantId ?? "";
    }

    protected override getAuthentication(p: NetworkConnectionParams): ConnectionAuthentication {
        if (this.authMode === "service-principal") {
            return {
                type: "azure-active-directory-service-principal-secret",
                options: {
                    clientId: this.clientId,
                    clientSecret: p.password,
                    tenantId: this.tenantId,
                },
            };
        }

        return super.getAuthentication(p);
    }
}
