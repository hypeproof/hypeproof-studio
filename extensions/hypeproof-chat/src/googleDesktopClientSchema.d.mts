export const GOOGLE_DESKTOP_RESOURCE: string;
export interface PackagedGoogleDesktop { schema: 'hps-google-desktop/1'; clientId: string; clientSecret: string }
export function parseGoogleDesktopSource(text: string): PackagedGoogleDesktop;
export function parsePackagedGoogleDesktop(text: string, expectedClientId: string): PackagedGoogleDesktop;
