import { test, expect } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
// Parcours PUBLICS (sans authentification) — s'exécutent toujours.
// Vérifient que l'application boote, que l'écran d'accueil rend, et que la porte
// d'authentification est bien en place (aucun accès aux données sans connexion).
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Smoke — écran public', () => {
  test('la landing rend sans erreur fatale', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', e => pageErrors.push(e.message));

    await page.goto('/');

    // Le titre de l'onglet porte le nom de l'application.
    await expect(page).toHaveTitle(/MetalFlow Pro/i);
    // La marque est visible.
    await expect(page.getByText('MetalFlow Pro').first()).toBeVisible();

    // Aucune exception non capturée n'a fait planter le boot (les échecs réseau
    // Supabase sont gérés et ne comptent pas comme pageerror).
    expect(pageErrors, `Erreurs non capturées: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });

  test('le formulaire de connexion est présent et éditable', async ({ page }) => {
    await page.goto('/');

    const email = page.getByPlaceholder(/@/).first();
    const password = page.locator('input[type="password"]').first();
    await expect(email).toBeVisible();
    await expect(password).toBeVisible();

    await email.fill('ingenieur@exemple.com');
    await password.fill('un-mot-de-passe');
    await expect(email).toHaveValue('ingenieur@exemple.com');

    // Le bouton de connexion existe.
    await expect(page.getByRole('button', { name: /se connecter/i }).first()).toBeVisible();
  });

  test('porte d\'authentification : pas de contenu projet sans connexion', async ({ page }) => {
    await page.goto('/');
    // La sidebar des modules (Tableau de bord, etc.) ne doit PAS être visible
    // tant qu'on n'est pas connecté et approuvé.
    await expect(page.getByRole('button', { name: /tableau de bord/i })).toHaveCount(0);
  });
});
