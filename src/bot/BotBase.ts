import {Telegraf, session} from 'telegraf';
import {Redis} from '@telegraf/session/redis';
import {Config} from '../types';
import {SocksProxyAgent} from 'socks-proxy-agent';
import HttpProxyAgent from 'http-proxy-agent';
import http from 'http';

export class BotBase {
  public bot: Telegraf;
  public proxyAgent: http.Agent | undefined = undefined;

  constructor(protected config: Config) {
    const proxy = config.proxy;
    if (proxy) {
      if (proxy.startsWith('socks5://')) {
        this.proxyAgent = new SocksProxyAgent(proxy);
      } else {
        this.proxyAgent = new HttpProxyAgent.HttpProxyAgent(proxy);
      }
    }

    this.bot = new Telegraf(config.bot.token, {
      telegram: {
        agent: this.proxyAgent,
      },
    });

    if (config.redis && config.redis.length > 0) {
      // store to redis
      this.bot.use(session({store: Redis({url: config.redis})}));
    } else {
      // only on memory
      this.bot.use(session());
    }
  }

  async finalStart() {
    return this.bot.launch({
      dropPendingUpdates: true,
    });
  }
}
