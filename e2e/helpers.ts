import { Page, expect } from '@playwright/test';

/** Identifiants d'un compte de TEST approuvé, fournis par l'environnement. */
export const E2E_EMAIL = process.env.E2E_EMAIL;
export const E2E_PASSWORD = process.env.E2E_PASSWORD;

/** Vrai si un compte de test est disponible pour les parcours authentifiés. */
export function hasCredentials(): boolean {
  return !!(E2E_EMAIL && E2E_PASSWORD);
}

/**
 * Connecte l'utilisateur de test et attend l'arrivée sur la liste des projets
 * (ou l'écran « en attente d'approbation »). À n'appeler que si hasCredentials().
 */
export async function login(page: Page): Promise<void> {
  if (!hasCredentials()) throw new Error('login() appelé sans E2E_EMAIL/E2E_PASSWORD');
  await page.goto('/');
  // L'écran d'accueil porte le formulaire de connexion.
  await page.getByPlaceholder(/ingenieur@|@/i).first().fill(E2E_EMAIL!);
  await page.getByPlaceholder(/•|mot de passe|password/i).first().fill(E2E_PASSWORD!);
  await page.getByRole('button', { name: /se connecter/i }).click();
  // Après connexion : soit la liste des projets, soit l'écran d'approbation.
  await expect(
    page.getByText(/projet|en attente|approbation|nouveau projet/i).first(),
  ).toBeVisible({ timeout: 20_000 });
}
