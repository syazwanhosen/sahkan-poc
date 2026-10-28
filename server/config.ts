// MyInvois settings, read from MYINVOIS_* variables (vite.config.ts loads them from .env).
// Secrets stay on this side: the browser only ever sees what /status reports.

export type MyInvoisEnv = 'sandbox' | 'production';
export type DocVersion = '1.0' | '1.1';

export interface Credentials {
  clientId: string;
  clientSecret: string;
}

export interface Config {
  env: MyInvoisEnv;
  apiBase: string;
  portalBase: string;
  /** The taxpayer's own ERP system. */
  taxpayer?: Credentials;
  /** An intermediary's ERP system, acting for clients through the onbehalfof header. */
  intermediary?: Credentials;
  /** PEM certificate and private key for v1.1 signatures. */
  certFile?: string;
  keyFile?: string;
  keyPassphrase?: string;
  /** Forces a document version; otherwise 1.1 when a certificate is set, else 1.0. */
  version?: DocVersion;
  /** Extra root certificates (PEM), for networks that inspect TLS. */
  caFile?: string;
  /** Host names allowed to call the API besides localhost. */
  allowedHosts: string[];
}

export const URLS: Record<MyInvoisEnv, { api: string; portal: string }> = {
  sandbox: { api: 'https://preprod-api.myinvois.hasil.gov.my', portal: 'https://preprod.myinvois.hasil.gov.my' },
  production: { api: 'https://api.myinvois.hasil.gov.my', portal: 'https://myinvois.hasil.gov.my' },
};

function creds(id?: string, secret?: string): Credentials | undefined {
  return id?.trim() && secret?.trim() ? { clientId: id.trim(), clientSecret: secret.trim() } : undefined;
}

export function readConfig(e: Record<string, string | undefined>): Config {
  const env: MyInvoisEnv = e.MYINVOIS_ENV?.trim().toLowerCase() === 'production' ? 'production' : 'sandbox';
  const version = e.MYINVOIS_DOC_VERSION?.trim();
  return {
    env,
    // MYINVOIS_API_BASE points at a mock server in tests; normally it is left unset.
    apiBase: e.MYINVOIS_API_BASE?.trim().replace(/\/+$/, '') || URLS[env].api,
    portalBase: URLS[env].portal,
    taxpayer: creds(e.MYINVOIS_CLIENT_ID, e.MYINVOIS_CLIENT_SECRET),
    intermediary: creds(e.MYINVOIS_INTERMEDIARY_CLIENT_ID, e.MYINVOIS_INTERMEDIARY_CLIENT_SECRET),
    certFile: e.MYINVOIS_CERT_FILE?.trim() || undefined,
    keyFile: e.MYINVOIS_KEY_FILE?.trim() || undefined,
    keyPassphrase: e.MYINVOIS_KEY_PASSPHRASE || undefined,
    version: version === '1.0' || version === '1.1' ? version : undefined,
    caFile: e.MYINVOIS_CA_FILE?.trim() || undefined,
    allowedHosts: (e.MYINVOIS_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  };
}
