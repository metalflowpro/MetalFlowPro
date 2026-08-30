# Tests E2E (Playwright)

Socle de tests de bout-en-bout pour MetalFlow Pro. Couvre les parcours réels dans
un vrai navigateur (Chromium), en complément des 1300+ tests unitaires (logique
métier) qui ne testent pas l'application elle-même.

## Lancer

```bash
# Contre un serveur dev local démarré automatiquement (parcours publics)
npm run test:e2e

# En mode interactif (UI Playwright)
npm run test:e2e:ui

# Contre un environnement déployé (aucun serveur local lancé)
E2E_BASE_URL=https://metalflowpro.com npm run test:e2e
```

Première fois : installer le navigateur avec `npx playwright install chromium`.

## Parcours couverts

- **`smoke.spec.ts`** (toujours exécuté, sans authentification) : la landing
  boote sans erreur fatale, le formulaire de connexion est présent, et la porte
  d'authentification bloque l'accès aux modules sans connexion.
- **`plant-optimizer.spec.ts`** (parcours authentifié) : connexion → ouverture
  d'un projet → module Plant Optimizer → lancement de la simulation → lecture d'un
  débit. **Ignoré automatiquement** tant que `E2E_EMAIL` / `E2E_PASSWORD` ne sont
  pas fournis.

## Activer les parcours authentifiés

Il faut un **compte de test approuvé** (l'inscription est self-service avec
validation admin). Fournir ses identifiants par variables d'environnement :

```bash
E2E_EMAIL="qa@exemple.com" E2E_PASSWORD="…" E2E_BASE_URL=https://metalflowpro.com npm run test:e2e
```

En CI, définir les secrets de dépôt `E2E_EMAIL` / `E2E_PASSWORD` (et
`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` pour cibler la vraie base). Sans
eux, le job E2E exécute uniquement les parcours publics et ignore le reste — il
reste vert.

> ⚠️ N'utilisez jamais un compte de production réel : créez un compte de QA dédié,
> sur un projet de test, pour éviter toute écriture indésirable.
