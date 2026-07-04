// Namespaced localStorage. On GitHub Pages the origin (<user>.github.io) is
// shared by ALL of the user's Pages projects, so bare keys like "model-url"
// could collide with another app. Every key gets a "pocket-agent:" prefix,
// and a schema version is stored so future format changes can migrate.

// The dev channel lives on the same origin (…/dev/), so its keys get their
// own namespace — otherwise the two installed apps would fight over state.
const PREFIX =
  __CHANNEL__ === 'stable' ? 'pocket-agent:' : `pocket-agent:${__CHANNEL__}:`;
const SCHEMA_VERSION = 1;

export function getItem(key: string): string | null {
  return localStorage.getItem(PREFIX + key);
}

export function setItem(key: string, value: string): void {
  localStorage.setItem(PREFIX + key, value);
}

export function removeItem(key: string): void {
  localStorage.removeItem(PREFIX + key);
}

export function allKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(PREFIX)) keys.push(k.slice(PREFIX.length));
  }
  return keys;
}

/** Runs pending migrations. Call once at startup, before any storage reads. */
export function migrate(): void {
  const version = Number(getItem('schema-version') ?? 0);
  if (version < 1 && __CHANNEL__ === 'stable') {
    // v0 → v1: move the unprefixed keys shipped in the first release.
    // Stable only — the dev channel must not steal the stable app's keys.
    for (const key of ['model-url', 'install-banner-dismissed']) {
      const old = localStorage.getItem(key);
      if (old !== null) {
        setItem(key, old);
        localStorage.removeItem(key);
      }
    }
  }
  // Future migrations stack here: if (version < 2) { ... }
  if (version !== SCHEMA_VERSION) {
    setItem('schema-version', String(SCHEMA_VERSION));
  }
}

/**
 * Ask the browser to protect this origin's storage from automatic eviction
 * (iOS in particular can wipe site data — including cached models — after
 * ~7 days of disuse). Safe to call repeatedly; browsers may decline silently.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
