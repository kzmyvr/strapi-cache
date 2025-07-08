import type { Core } from '@strapi/strapi';
import { LRUCache } from 'lru-cache';
import { withTimeout } from '../../utils/withTimeout';
import { CacheProvider, CacheService } from '../../types/cache.types';
import { loggy } from '../../utils/log';

export class InMemoryCacheProvider implements CacheProvider {
  private initialized = false;
  private provider!: LRUCache<string, any>;
  private cacheGetTimeoutInMs: number;

  constructor(private strapi: Core.Strapi) {}

  init(): void {
    if (this.initialized) {
      loggy.error('Provider already initialized');
      return;
    }

    try {
      const max = Number(this.strapi.plugin('strapi-cache').config('max')) || 1000;
      const ttl = Number(this.strapi.plugin('strapi-cache').config('ttl')) || 1000 * 60 * 60;
      const size = Number(this.strapi.plugin('strapi-cache').config('size')) || 1024 * 1024 * 10;
      const allowStale = Boolean(this.strapi.plugin('strapi-cache').config('allowStale')) || false;

      // Validate configuration values
      if (max <= 0) throw new Error('max must be greater than 0');
      if (ttl < 0) throw new Error('ttl must be non-negative');
      if (size <= 0) throw new Error('size must be greater than 0');

      this.provider = new LRUCache({
        max,
        ttl,
        size,
        allowStale,
        updateAgeOnGet: true,
        noDisposeOnSet: true,
      });

      this.cacheGetTimeoutInMs = Number(
        this.strapi.plugin('strapi-cache').config('cacheGetTimeoutInMs')
      ) || 1000;

      if (this.cacheGetTimeoutInMs <= 0) {
        this.cacheGetTimeoutInMs = 1000;
      }

      this.initialized = true;
      loggy.info('Provider initialized');
    } catch (error) {
      loggy.error(`Failed to initialize provider: ${error}`);
      throw error;
    }
  }

  get ready(): boolean {
    return this.initialized && this.provider !== undefined;
  }

  async get(key: string): Promise<any | null> {
    if (!this.ready) {
      loggy.warn('Provider not ready for get operation');
      return null;
    }

    if (!key || typeof key !== 'string') {
      loggy.warn('Invalid key provided for get operation');
      return null;
    }

    return withTimeout(
      () =>
        new Promise((resolve) => {
          try {
            const result = this.provider.get(key);
            resolve(result);
          } catch (error) {
            loggy.error(`Error during provider get: ${error}`);
            resolve(null);
          }
        }),
      this.cacheGetTimeoutInMs
    ).catch((error) => {
      loggy.error(`Error during get: ${error?.message || error}`);
      return null;
    });
  }

  async set(key: string, val: any): Promise<any | null> {
    if (!this.ready) {
      loggy.warn('Provider not ready for set operation');
      return null;
    }

    if (!key || typeof key !== 'string') {
      loggy.warn('Invalid key provided for set operation');
      return null;
    }

    try {
      return this.provider.set(key, val);
    } catch (error) {
      loggy.error(`Error during set: ${error}`);
      return null;
    }
  }

  async del(key: string): Promise<any | null> {
    if (!this.ready) {
      loggy.warn('Provider not ready for delete operation');
      return null;
    }

    if (!key || typeof key !== 'string') {
      loggy.warn('Invalid key provided for delete operation');
      return null;
    }

    try {
      loggy.info(`PURGING KEY: ${key}`);
      return this.provider.delete(key);
    } catch (error) {
      loggy.error(`Error during delete: ${error}`);
      return null;
    }
  }

  async keys(): Promise<string[] | null> {
    if (!this.ready) {
      loggy.warn('Provider not ready for keys operation');
      return null;
    }

    try {
      return Array.from(this.provider.keys());
    } catch (error) {
      loggy.error(`Error fetching keys: ${error}`);
      return null;
    }
  }

  async reset(): Promise<any | null> {
    if (!this.ready) {
      loggy.warn('Provider not ready for reset operation');
      return null;
    }

    try {
      const allKeys = await this.keys();
      if (!allKeys) return null;

      loggy.info(`PURGING ALL KEYS: ${allKeys.length}`);
      await Promise.all(allKeys.map((key) => this.del(key)));
      return true;
    } catch (error) {
      loggy.error(`Error during reset: ${error}`);
      return null;
    }
  }

  async clearByRegexp(regExps: RegExp[]): Promise<void> {
    if (!this.ready) {
      loggy.warn('Provider not ready for clearByRegexp operation');
      return;
    }

    try {
      const keys = (await this.keys()) || [];
      const matches = keys.filter((key) => regExps.some((re) => re.test(key)));
      await Promise.all(matches.map((key) => this.del(key)));
      loggy.info(`Cleared ${matches.length} keys matching regex patterns`);
    } catch (error) {
      loggy.error(`Error during clearByRegexp: ${error}`);
    }
  }
}
