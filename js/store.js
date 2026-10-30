// Reads and saves the data files. They live in the GitHub repository, so every
// device sees the same room list.
//
// Without a key, files are read from the published site (anyone can view; it
// updates about a minute after each save). With a key saved on this device,
// files are read straight from the repository through the GitHub API, which is
// always current, and changes are committed to it.

export const REPO = { owner: 'tmoosabhoy6', repo: 'Karbala-Accommodation-', branch: 'main' };

const API = `https://api.github.com/repos/${REPO.owner}/${REPO.repo}/contents`;
const KEY_STORAGE = 'karbala-rooms:github-key';

export class KeyError extends Error {}
export class ConflictError extends Error {}

export function getKey() {
  try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; }
}

export function setKey(key) {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
    return true;
  } catch {
    return false;
  }
}

function decodeBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function encodeBase64(text) {
  let bin = '';
  for (const byte of new TextEncoder().encode(text)) bin += String.fromCharCode(byte);
  return btoa(bin);
}

function apiHeaders(key) {
  return { Authorization: `Bearer ${key}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
}

// Remembered ETags, so polling an unchanged file costs nothing.
const cached = new Map(); // path -> { etag, file }

async function readFromSite(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
  return { text: await res.text(), sha: null };
}

// Returns { text, sha }. sha is null when read from the published site.
export async function readFile(path, key = getKey()) {
  if (!key) return readFromSite(path);

  const headers = apiHeaders(key);
  const prev = cached.get(path);
  if (prev?.etag) headers['If-None-Match'] = prev.etag;
  let res;
  try {
    res = await fetch(`${API}/${path}?ref=${REPO.branch}`, { headers, cache: 'no-store' });
  } catch {
    return readFromSite(path);
  }
  if (res.status === 304 && prev) return prev.file;
  if (res.status === 401) throw new KeyError('This key is not valid any more.');
  if (res.status === 404 || res.status === 403) {
    throw new KeyError('This key cannot open the Karbala-Accommodation- repository.');
  }
  if (!res.ok) return readFromSite(path);

  const json = await res.json();
  const file = { text: decodeBase64(json.content), sha: json.sha };
  cached.set(path, { etag: res.headers.get('ETag'), file });
  return file;
}

// Commits new file contents. `sha` must be the version the change was made on;
// if someone else saved in between, ConflictError is thrown so the caller can
// re-apply the change on top of theirs.
export async function writeFile(path, text, sha, message, key = getKey()) {
  if (!key) throw new KeyError('Saving is not set up on this device.');
  let res;
  try {
    res = await fetch(`${API}/${path}`, {
      method: 'PUT',
      headers: { ...apiHeaders(key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: encodeBase64(text), sha, branch: REPO.branch }),
    });
  } catch {
    throw new Error('No connection. Check the internet and try again.');
  }
  if (res.status === 409 || res.status === 422) throw new ConflictError();
  if (res.status === 401) throw new KeyError('This key is not valid any more.');
  if (res.status === 403 || res.status === 404) {
    throw new KeyError('This key is not allowed to save. It needs "Contents: Read and write" on this repository.');
  }
  if (!res.ok) throw new Error(`GitHub did not accept the change (${res.status}). Try again.`);
  const json = await res.json();
  cached.delete(path);
  return json.content.sha;
}
