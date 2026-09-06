export function isJwtIssuedInFutureError(message: string | null | undefined): boolean {
  return /jwt\s+issued\s+at\s+future/i.test(message ?? '');
}

export const JWT_CLOCK_SKEW_MESSAGE = 'Votre session est désynchronisée avec le serveur. Reconnectez-vous et vérifiez que la date et l’heure automatiques de votre appareil sont activées.';

