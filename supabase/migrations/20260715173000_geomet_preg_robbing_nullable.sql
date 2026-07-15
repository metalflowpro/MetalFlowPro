/*
  # GéoMet — preg_robbing : autoriser NULL (« inconnu »)

  ## Problème

  `geomet_domains.preg_robbing` est `boolean NOT NULL DEFAULT false`. La colonne
  ne peut donc représenter que deux états : « preg-robbing avéré » et « pas de
  preg-robbing ». Il n'existe aucun moyen de dire « aucun essai réalisé ».

  Conséquence : un domaine sans essai de libération ni de carbone organique est
  affiché comme **exempt de preg-robbing**, alors que la donnée est simplement
  absente. C'est une affirmation métallurgique non étayée sur un paramètre qui
  décide de la conception du circuit CIL (ajout de charbon, blanking, etc.).

  ## Changement

  1. `preg_robbing` devient nullable ; `NULL` = inconnu / non testé.
  2. Le défaut `false` est retiré : un domaine créé sans verdict reste « inconnu »
     au lieu d'être présumé propre.

  ## Compatibilité

  - Les lignes existantes conservent `true`/`false` — aucune donnée réécrite.
  - Le code applicatif traite déjà les trois états (voir `derivePregRobbing`) et
    OMET le champ à l'insertion quand le verdict est inconnu ; il fonctionne donc
    avant comme après cette migration. Sans elle, « inconnu » retombe simplement
    sur `false` via l'ancien défaut.
  - Aucun index ni contrainte ne dépend de cette colonne.

  ## Note

  Les valeurs `false` déjà en base ne sont PAS converties en NULL : impossible de
  distinguer rétroactivement « testé et négatif » de « jamais testé ». Relancer
  « Sync LIMS + Block Model » réécrira le verdict depuis les essais réels.
*/

ALTER TABLE geomet_domains
  ALTER COLUMN preg_robbing DROP NOT NULL,
  ALTER COLUMN preg_robbing DROP DEFAULT;

COMMENT ON COLUMN geomet_domains.preg_robbing IS
  'Verdict preg-robbing du domaine. NULL = inconnu (aucun essai de libération ni de carbone organique). Dérivé de lims_test_liberation.au_preg_rob_pct > 0.5 %, sinon de lims_test_chem.c_organic_pct > 0.2 %.';
