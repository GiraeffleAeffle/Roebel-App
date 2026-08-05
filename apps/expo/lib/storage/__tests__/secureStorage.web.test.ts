import * as SecureStorage from '../secureStorage.web';

function installLocalStorageMock() {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
  return store;
}

describe('secureStorage.web', () => {
  let store: Map<string, string>;
  beforeEach(() => { store = installLocalStorageMock(); });

  it('round-trips a value', async () => {
    await SecureStorage.setItemAsync('maci-key', 'secret');
    expect(await SecureStorage.getItemAsync('maci-key')).toBe('secret');
  });

  it('returns null for missing keys', async () => {
    expect(await SecureStorage.getItemAsync('missing')).toBeNull();
  });

  it('namespaces by keychainService so services do not collide', async () => {
    await SecureStorage.setItemAsync('k', 'a', { keychainService: 'roebel-consent' });
    await SecureStorage.setItemAsync('k', 'b');
    expect(await SecureStorage.getItemAsync('k', { keychainService: 'roebel-consent' })).toBe('a');
    expect(await SecureStorage.getItemAsync('k')).toBe('b');
    expect(store.get('roebel.secure.roebel-consent.k')).toBe('a');
    expect(store.get('roebel.secure.default.k')).toBe('b');
  });

  it('deletes values', async () => {
    await SecureStorage.setItemAsync('k', 'v');
    await SecureStorage.deleteItemAsync('k');
    expect(await SecureStorage.getItemAsync('k')).toBeNull();
  });

  it('does not throw when localStorage is unavailable', async () => {
    delete (globalThis as any).localStorage;
    expect(await SecureStorage.getItemAsync('k')).toBeNull();
    await expect(SecureStorage.setItemAsync('k', 'v')).resolves.toBeUndefined();
    await expect(SecureStorage.deleteItemAsync('k')).resolves.toBeUndefined();
  });
});
