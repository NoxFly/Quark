/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { XMLBuilder, XMLParser } from "fast-xml-parser";

/**
 * Chiffrement symétrique d'un contenu texte dans une enveloppe XML.
 *
 * Utilisé à la fois pour le coffre local (clé dérivée du mot de passe maître)
 * et pour les fichiers d'export partageables (clé dérivée d'une passphrase).
 * Aucune dépendance externe au chiffrement : `node:crypto` (AES-256-GCM + scrypt).
 */

const CIPHER = "aes-256-gcm";
const KDF = "scrypt";
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const ENVELOPE_ROOT = "noxEditorVault";

// `parseTagValue: false` empêche la conversion d'un base64 entièrement numérique
// en nombre (ce qui corromprait les données chiffrées).
const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false });
const xmlBuilder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: "@_", format: true });

/**
 * Dérive une clé AES-256 de 32 octets à partir d'une passphrase et d'un sel.
 */
function deriveKey(passphrase: string, salt: Buffer): Buffer {
    return scryptSync(passphrase, salt, KEY_LENGTH);
}

/**
 * Chiffre un texte clair et retourne une enveloppe XML auto-décrivante.
 * @param plaintext - Contenu à chiffrer (lui-même du XML décrivant les profils).
 * @param passphrase - Secret de dérivation de la clé.
 * @returns Document XML contenant sel, IV, tag d'authentification et données chiffrées (base64).
 */
export function encryptToXml(plaintext: string, passphrase: string): string {
    const salt = randomBytes(SALT_LENGTH);
    const iv = randomBytes(IV_LENGTH);
    const key = deriveKey(passphrase, salt);

    const cipher = createCipheriv(CIPHER, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    const envelope = {
        [ENVELOPE_ROOT]: {
            "@_version": "1",
            "@_cipher": CIPHER,
            "@_kdf": KDF,
            salt: salt.toString("base64"),
            iv: iv.toString("base64"),
            tag: tag.toString("base64"),
            data: ciphertext.toString("base64"),
        },
    };

    return xmlBuilder.build(envelope);
}

/**
 * Déchiffre une enveloppe XML produite par `encryptToXml`.
 * @throws Si la passphrase est incorrecte (échec de vérification du tag GCM)
 *         ou si l'enveloppe est malformée.
 */
export function decryptFromXml(xml: string, passphrase: string): string {
    const parsed = xmlParser.parse(xml) as Record<string, unknown>;
    const envelope = parsed[ENVELOPE_ROOT] as Record<string, string> | undefined;

    if (!envelope?.["salt"] || !envelope["iv"] || !envelope["tag"] || envelope["data"] === undefined) {
        throw new Error("Invalid vault envelope");
    }

    const salt = Buffer.from(envelope["salt"], "base64");
    const iv = Buffer.from(envelope["iv"], "base64");
    const tag = Buffer.from(envelope["tag"], "base64");
    const ciphertext = Buffer.from(String(envelope["data"]), "base64");
    const key = deriveKey(passphrase, salt);

    const decipher = createDecipheriv(CIPHER, key, iv);
    decipher.setAuthTag(tag);

    // `final()` lève si le tag ne correspond pas → mot de passe / passphrase erroné.
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf-8");
}
