import type { Core } from '@strapi/strapi';
import { Redis, Cluster, ClusterNode, ClusterOptions } from 'ioredis';
import { withTimeout } from '../../utils/withTimeout';
import { CacheProvider } from '../../types/cache.types';
import { loggy } from '../../utils/log';

export class RedisCacheProvider implements CacheProvider {
  private initialized = false;
  private client!: Redis | Cluster;
  private cacheGetTimeoutInMs: number;

  constructor(private strapi: Core.Strapi) { }

  init(): void {
    if (this.initialized) {
      loggy.error('Redis provider already initialized');
      return;
    }
    
    try {
      const redisConfig =
        this.strapi.plugin('strapi-cache').config('redisConfig') || 'redis://localhost:6379';
      const redisClusterNodes: ClusterNode[] =
        this.strapi.plugin('strapi-cache').config('redisClusterNodes') || [];
      this.cacheGetTimeoutInMs = Number(
        this.strapi.plugin('strapi-cache').config('cacheGetTimeoutInMs')
      ) || 1000;

      if (this.cacheGetTimeoutInMs <= 0) {
        this.cacheGetTimeoutInMs = 1000;
      }

      if (redisClusterNodes.length > 0) {
        const redisClusterOptions: ClusterOptions =
          this.strapi.plugin('strapi-cache').config('redisClusterOptions') || {};
        if (!redisClusterOptions['redisOptions']) {
          redisClusterOptions.redisOptions = redisConfig;
        }
        this.client = new Redis.Cluster(redisClusterNodes, redisClusterOptions);
      } else {
        this.client = new Redis(redisConfig);
      }

      // Add error handling for Redis client
      this.client.on('error', (error) => {
        loggy.error(`Redis client error: ${error}`);
      });

      this.client.on('connect', () => {
        loggy.info('Redis client connected');
      });

      this.client.on('ready', () => {
        loggy.info('Redis client ready');
      });

      this.initialized = true;
      loggy.info('Redis provider initialized');
    } catch (error) {
      loggy.error(`Failed to initialize Redis provider: ${error}`);
      throw error;
    }
  }

  get ready(): boolean {
    return this.initialized && this.client !== undefined;
  }

  async get(key: string): Promise<any | null> {
    if (!this.ready) {
      loggy.warn('Redis provider not ready for get operation');
      return null;
    }

    if (!key || typeof key !== 'string') {
      loggy.warn('Invalid key provided for Redis get operation');
      return null;
    }

    return withTimeout(() => this.client.get(key), this.cacheGetTimeoutInMs)
      .then((data) => {
        if (!data) return null;
        try {
          return JSON.parse(data);
        } catch (error) {
          loggy.error(`Failed to parse Redis data: ${error}`);
          return null;
        }
      })
      .catch((error) => {
        loggy.error(`Redis get error: ${error?.message || error}`);
        return null;
      });
  }

  async set(key: string, val: any): Promise<any | null> {
    if (!this.ready) {
      loggy.warn('Redis provider not ready for set operation');
      return null;
    }

    if (!key || typeof key !== 'string') {
      loggy.warn('Invalid key provided for Redis set operation');
      return null;
    }

    try {
      // plugin ttl is ms, ioredis ttl is s, so we convert here
      const ttlInMs = Number(this.strapi.plugin('strapi-cache').config('ttl')) || 1000 * 60 * 60;
      const ttlInS = Math.max(0, Math.floor(ttlInMs / 1000));
      
      let serialized;
      try {
        serialized = JSON.stringify(val);
      } catch (error) {
        loggy.error(`Failed to serialize value for Redis: ${error}`);
        return null;
      }

      if (ttlInS > 0) {
        await this.client.set(key, serialized, 'EX', ttlInS);
      } else {
        await this.client.set(key, serialized);
      }
      return val;
    } catch (error) {
      loggy.error(`Redis set error: ${error}`);
      return null;
    }
  }

  async del(key: string): Promise<any | null> {
    if (!this.ready) {
      loggy.warn('Redis provider not ready for delete operation');
      return null;
    }

    if (!key || typeof key !== 'string') {
      loggy.warn('Invalid key provided for Redis delete operation');
      return null;
    }

    try {
      loggy.info(`Redis PURGING KEY: ${key}`);
      await this.client.del(key);
      return true;
    } catch (error) {
      loggy.error(`Redis del error: ${error}`);
      return null;
    }
  }

  async keys(): Promise<string[] | null> {
    if (!this.ready) {
      loggy.warn('Redis provider not ready for keys operation');
      return null;
    }

    try {
      const keys = await this.client.keys('*');
      return keys;
    } catch (error) {
      loggy.error(`Redis keys error: ${error}`);
      return null;
    }
  }

  async reset(): Promise<any | null> {
    if (!this.ready) {
      loggy.warn('Redis provider not ready for reset operation');
      return null;
    }

    try {
      loggy.info(`Redis FLUSHING ALL KEYS`);
      await this.client.flushdb();
      return true;
    } catch (error) {
      loggy.error(`Redis reset error: ${error}`);
      return null;
    }
  }

  async clearByRegexp(regExps: RegExp[]): Promise<void> {
    if (!this.ready) {
      loggy.warn('Redis provider not ready for clearByRegexp operation');
      return;
    }

    try {
      const keys = await this.keys();
      if (!keys) return;

      const toDelete = keys.filter((key) => regExps.some((re) => re.test(key)));
      for (const key of toDelete) {
        await this.del(key);
      }
      loggy.info(`Cleared ${toDelete.length} Redis keys matching regex patterns`);
    } catch (error) {
      loggy.error(`Error during Redis clearByRegexp: ${error}`);
    }
  }
}
