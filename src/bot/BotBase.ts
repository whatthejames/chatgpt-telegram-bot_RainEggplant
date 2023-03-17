import {Telegraf, session, Context} from 'telegraf';
import {Redis} from '@telegraf/session/redis';
import {Config} from '../types';
import {SocksProxyAgent} from 'socks-proxy-agent';
import HttpProxyAgent from 'http-proxy-agent';
import http from 'http';
import {Deunionize} from 'telegraf/typings/deunionize';
import {Update} from 'typegram';
import Keyv from 'keyv';
import _ from 'lodash';

export interface StoreKeyV {
  get<Value = unknown, Raw extends boolean = false>(
    key: string,
    options?: {raw?: Raw}
  ): Promise<
    (Raw extends false ? Value : Keyv.DeserializedData<Value>) | undefined
  >;

  set<Value = unknown>(key: string, value: Value, ttl?: number): Promise<true>;

  delete(key: string | string[]): Promise<boolean>;

  has(key: string): Promise<boolean>;
}

export interface ExtendedContext<U extends Deunionize<Update> = Update>
  extends Context<U> {
  session?: {[key: string]: unknown};

  getSessionKeyForStore(): string | undefined;

  storeKeyV: StoreKeyV;
}

export class BotBase {
  public bot: Telegraf<ExtendedContext>;
  public proxyAgent: http.Agent | undefined = undefined;

  constructor(protected config: Config, public keyv: Keyv) {
    const proxy = config.proxy;
    if (proxy) {
      const m = proxy.match(
        /^socks[45][ha]?:\/\/((([^@.:]+)@([^@.:]+)):)?([^:]+):(\d+)$/
      );
      if (proxy.startsWith('socks') && m) {
        console.log('socks.proxy.match', [m[5], m[6]]);
        this.proxyAgent = new SocksProxyAgent({
          hostname: m[5],
          port: m[6],
        });
      } else {
        this.proxyAgent = new HttpProxyAgent.HttpProxyAgent(proxy);
      }
    }

    this.bot = new Telegraf<ExtendedContext>(config.bot.token, {
      telegram: {
        agent: this.proxyAgent,
      },
    });

    // error catch
    this.bot.use(async (ctx, next) => {
      return next().catch((E) => {
        console.error(E);
      });
    });

    if (config.redis && config.redis.length > 0) {
      // store to redis
      this.bot.use(session({store: Redis({url: config.redis})}));
    } else {
      // only on memory
      this.bot.use(session());
    }

    this.bot.use((ctx, next) => {
      // patch Context to ExtendedContext

      ctx.getSessionKeyForStore = (): string | undefined => {
        const fromId = ctx.from?.id;
        const chatId = ctx.chat?.id;
        if (fromId == null || chatId == null) {
          return undefined;
        }
        return `ChatGptTelegraf:${fromId}:${chatId}`;
      };

      ctx.storeKeyV = {} as StoreKeyV;
      ctx.storeKeyV.set = (s, v, ttl) => {
        return this.keyv.set(`${ctx.getSessionKeyForStore()}:${s}`, v, ttl);
      };
      ctx.storeKeyV.get = (s, options) => {
        return this.keyv.get(`${ctx.getSessionKeyForStore()}:${s}`, options);
      };
      ctx.storeKeyV.has = (s) => {
        return this.keyv.has(`${ctx.getSessionKeyForStore()}:${s}`);
      };
      ctx.storeKeyV.delete = (s) => {
        return this.keyv.delete(
          _.isString(s)
            ? `${ctx.getSessionKeyForStore()}:${s}`
            : s.map((S) => `${ctx.getSessionKeyForStore()}:${S}`)
        );
      };

      // now patch end.
      return next();
    });
  }

  async finalStart() {
    await this.bot.launch({
      dropPendingUpdates: true,
    });

    const L: number[] | undefined = await this.keyv.get(
      `ChatGptTelegraf:InChat`
    );
    if (L && _.isArray(L)) {
      for (const v of L) {
        await this.bot.telegram.sendMessage(v, `Hi, i'm back`);
      }
    }
  }
}
