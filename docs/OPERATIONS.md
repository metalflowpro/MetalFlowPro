# Exploitation — environnements, livraison, sauvegardes

## Environnements

| | Production | Staging (recette) |
|---|---|---|
| Site | https://metalflowpro.com | https://metalflowpro-staging.up.railway.app |
| Railway | projet MetalFlowPro › env `production` | même projet › env `staging` |
| Supabase | `qbcvrwyapvzugekbhrfy` (bolt-native-database) | `pjddrdvshzwjeyqlgfbp` (metalflowpro's Project) |
| Indexation | oui | non (`VITE_PUBLIC_NOINDEX=true`) |
| Copilote IA | activé | désactivé (fonction non déployée) |

Les références de projet vivent dans `scripts/db/environments.sh`.

⚠️ La CLI Railway mémorise un environnement « lié » : toujours passer
`--environment` explicitement (`railway up --environment production`).

## Livrer une modification

1. PR → CI verte (lint, typecheck, tests, banc SQL, E2E smoke).
2. Fusion sur `main` → le workflow **Staging** applique les migrations sur la
   base de staging et déploie l'environnement staging.
3. Recette sur https://metalflowpro-staging.up.railway.app.
4. `scripts/release.sh` (ou `--dry-run` pour voir ce qui partirait) :
   qualité + banc SQL → migrations prod **refusées si staging ne les a pas
   toutes** → sauvegarde prod automatique juste avant → déploiement prod →
   contrôle HTTP + en-têtes.

Migrations à la main : `scripts/db/migrate.sh staging|production [--apply]`.
Le script travaille dans un dossier temporaire lié au bon projet : le lien CLI
du dépôt n'est jamais modifié.

## Sauvegardes

- **Automatique** : workflow `db-backup.yml`, chaque jour à 06:17 UTC —
  export complet chiffré (AES-256) + **restauration de vérification** dans un
  PostgreSQL 17 jetable (comparaison des lignes de chaque table au manifeste),
  archive GitHub conservée 90 jours.
- **À la demande** : `scripts/db/backup.sh production` (défaut
  `~/MetalFlowPro-backups`, chiffré si `BACKUP_PASSPHRASE` est défini), puis
  `scripts/db/verify-restore.sh`.
- Contenu : rôles, schéma applicatif, données (comptes `auth.users` /
  `auth.identities` compris), structure auth/storage, manifeste, SHA-256.
- Non couvert : les fichiers du Storage Supabase (aucun bucket utilisé à ce
  jour) et la configuration Auth du tableau de bord (à reporter à la main).

Supabase (offre actuelle) ne conserve **aucune** sauvegarde physique ni PITR
pour la production : ces exports sont la seule copie restaurable.

## Restaurer après sinistre

1. Récupérer la dernière archive (`Actions › Sauvegarde base › artefact`) et la
   phrase `BACKUP_PASSPHRASE` (conservée hors de GitHub).
2. Déchiffrer : `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in data.sql.gz.enc | gunzip > data.sql`
   (idem pour `roles`, `schema`).
3. Créer un projet Supabase neuf (même région de préférence), puis avec sa
   chaîne de connexion (`postgresql://postgres:…@db.<ref>.supabase.co:5432/postgres`) :
   ```bash
   psql "$URL" -f roles.sql
   psql "$URL" -f schema.sql
   psql "$URL" -c 'SET session_replication_role = replica' -f data.sql
   ```
4. Vérifier les comptes avec `manifest.tsv`, reporter la configuration Auth
   (URL du site, redirections, limites), redéployer les fonctions Edge
   (`supabase functions deploy`), puis faire pointer Railway
   (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) sur le nouveau projet.

## Secrets GitHub à configurer

| Secret | Usage |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | sauvegardes + migrations staging (jeton personnel Supabase) |
| `BACKUP_PASSPHRASE` | chiffrement des sauvegardes — en garder une copie hors GitHub |
| `RAILWAY_STAGING_TOKEN` | déploiement automatique du staging (jeton de projet limité à `staging`) |

## Authentification

- Côté app : ralentissement progressif après des échecs de connexion
  (`src/lib/auth/loginThrottle.ts`) et captcha Cloudflare Turnstile, actif dès
  que `VITE_TURNSTILE_SITE_KEY` est défini **et** que le captcha est activé
  dans Supabase (Auth › Attack Protection, avec la clé secrète Turnstile).
- Côté serveur : limites de Supabase Auth (Auth › Rate Limits). Staging :
  10 connexions/inscriptions par 5 min et par IP.
