export class MemoryKV {
  constructor() {
    this.store = new Map();
  }

  async get(key) {
    const entry = this.store.get(key);
    return entry ? entry.value : null;
  }

  async put(key, value, options = {}) {
    this.store.set(key, {
      value,
      metadata: options.metadata ?? null,
      expirationTtl: options.expirationTtl ?? null
    });
  }

  async delete(key) {
    this.store.delete(key);
  }

  async list({ prefix = '', limit = 1000, cursor } = {}) {
    const names = Array.from(this.store.keys())
      .filter((name) => name.startsWith(prefix))
      .sort();

    const start = cursor ? Number(cursor) : 0;
    const slice = names.slice(start, start + limit);
    const keys = slice.map((name) => ({
      name,
      metadata: this.store.get(name).metadata
    }));

    const end = start + slice.length;
    const list_complete = end >= names.length;

    return {
      keys,
      list_complete,
      cursor: list_complete ? undefined : String(end)
    };
  }
}
