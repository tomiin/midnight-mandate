import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Why this exists (verified, not guessed):
//
// Node 22 ships an experimental Web Storage API. When it's enabled in the
// environment, Node defines a native `localStorage` on `globalThis` that does
// not work without `--localstorage-file` — it just warns and yields undefined.
//
// Vitest's jsdom environment builds the test global via `populateGlobal`, whose
// key filter reads:
//     if (k in global) return keysArray.includes(k);
// i.e. any key ALREADY present on the Node global is skipped unless it appears
// in vitest's own hardcoded allowlist — and `localStorage` is not in that list.
// So when Node's native version is present, jsdom's perfectly good
// `window.localStorage` is never wired onto the global at all. And because
// `populateGlobal` also does `global.window = global`, `window.localStorage`
// resolves to the same broken native getter, so both break together.
//
// Confirmed by running vitest's own environment setup with and without
// `--experimental-webstorage`: `'localStorage' in globalThis` is false/true
// respectively, which flips that filter and reproduces the failure exactly.
//
// The real JSDOM instance's Storage works fine in both cases, and vitest
// exposes that instance as the `jsdom` global — so take it from there.
type StorageKind = "localStorage" | "sessionStorage";

function inMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => {
      map.clear();
    },
  } as Storage;
}

function workingStorage(kind: StorageKind): Storage {
  const fromJsdom = (
    globalThis as unknown as { jsdom?: { window?: Record<StorageKind, Storage> } }
  ).jsdom?.window?.[kind];
  // Fall back to an in-memory implementation if the jsdom global isn't there
  // (e.g. a non-jsdom environment), so tests still get a usable Storage.
  return fromJsdom ?? inMemoryStorage();
}

vi.stubGlobal("localStorage", workingStorage("localStorage"));
vi.stubGlobal("sessionStorage", workingStorage("sessionStorage"));
