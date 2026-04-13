import { Injectable } from "@noxfly/noxus";


/**
 * 1 instance par connexion à une BDD,
 * donc 1 instance par fenêtre (renderer)
 */
@Injectable({ lifetime: "transient" })
export class Database {

}
