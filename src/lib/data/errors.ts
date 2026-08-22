// ─────────────────────────────────────────────────────────────────────────────
// MetalFlow Pro — Erreurs typées de la couche de données (S7)
//
// NOTE DE PROVENANCE : ce fichier est le seul de la livraison S7 qui n'était pas
// fourni verbatim dans les documents de la Phase 0. Son contenu est entièrement
// déterminé par l'usage qu'en font les fichiers fournis (`mutations.ts`,
// `commandRouter.ts`) : trois erreurs de persistance + une erreur de routeur.
// Il est reconstruit ici comme glue minimale pour que les fichiers fournis
// compilent et s'exécutent. Remplacez-le par la version d'origine si vous la
// récupérez.
//
// Sémantique (cf. « S7 — Socle applicatif ») :
//   - DataPersistenceError     : échec prouvé (erreur serveur, 0 ligne, nombre
//                                inattendu). Classe de base des deux suivantes.
//   - DataNotPersistedError    : 0 ligne affectée (piège T3b) ou nombre inattendu.
//   - AffectedRowsUnknownError : impossible de prouver le nombre de lignes
//                                (ni `count` ni `data`) → échec fermé (fail closed).
//   - UnknownCommandError      : commande `module.action` non enregistrée au routeur.
// ─────────────────────────────────────────────────────────────────────────────

/** Échec de persistance prouvé. Porte optionnellement la cause serveur d'origine. */
export class DataPersistenceError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'DataPersistenceError';
    this.cause = cause;
    Object.setPrototypeOf(this, DataPersistenceError.prototype);
  }
}

/** 0 ligne affectée (piège T3b) ou nombre de lignes différent de l'attendu. */
export class DataNotPersistedError extends DataPersistenceError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'DataNotPersistedError';
    Object.setPrototypeOf(this, DataNotPersistedError.prototype);
  }
}

/** Nombre de lignes affectées impossible à prouver → on refuse de conclure (fail closed). */
export class AffectedRowsUnknownError extends DataPersistenceError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'AffectedRowsUnknownError';
    Object.setPrototypeOf(this, AffectedRowsUnknownError.prototype);
  }
}

/** Commande `module.action` inconnue du routeur : aucune écriture n'a eu lieu. */
export class UnknownCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnknownCommandError';
    Object.setPrototypeOf(this, UnknownCommandError.prototype);
  }
}
