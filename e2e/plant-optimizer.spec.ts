import { test, expect } from '@playwright/test';
import { hasCredentials, login } from './helpers';

// ─────────────────────────────────────────────────────────────────────────────
// Parcours AUTHENTIFIÉS — ignorés automatiquement sans compte de test
// (E2E_EMAIL / E2E_PASSWORD). Couvrent le cœur métier : ouvrir un projet,
// atteindre le Plant Optimizer, lancer une simulation et lire un résultat.
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Plant Optimizer — parcours authentifié', () => {
  test.skip(!hasCredentials(), 'E2E_EMAIL / E2E_PASSWORD non fournis — parcours authentifié ignoré');

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('ouvrir un projet, lancer la simulation et lire un débit', async ({ page }) => {
    // Ouvre le premier projet de la liste.
    const firstProject = page.getByRole('button', { name: /—|projet/i }).first();
    if (await firstProject.count()) await firstProject.click();

    // Navigue vers le module Plant Optimizer via la barre latérale.
    await page.getByRole('button', { name: /plant optimizer/i }).click();
    await expect(page.getByRole('heading', { name: /plant optimizer/i })).toBeVisible();

    // Lance la simulation.
    await page.getByRole('button', { name: /lancer la simulation/i }).click();

    // Un résultat apparaît (onglet Résultats + KPI de débit).
    await expect(page.getByText(/débit p50/i).first()).toBeVisible({ timeout: 30_000 });
  });
});
