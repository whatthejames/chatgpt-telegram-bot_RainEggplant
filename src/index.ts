import {ChatGPT} from './api';
import {loadConfig} from './utils';
import Keyv, {Store} from 'keyv';
import QuickLRU from 'quick-lru';
import {GlobalConfig, globalConfig} from './GlobalConfig';
import {initRoleMode} from './PromptsRole';
import {ServerApp} from './server/app';
import {BotBase} from './bot/BotBase';
import {BotCommand} from './bot/BotCommand';
import {BotAuthenticate} from './bot/BotAuthenticate';
import {BotChat} from './bot/BotChat';

let keyv: Keyv;

async function main() {
  const config = loadConfig();

  if (config.redis && config.redis.length > 0) {
    keyv = new Keyv(config.redis);
  } else {
    // same as npm chatgpt package
    keyv = new Keyv({
      store: new QuickLRU({maxSize: 1e4}) as Store<string | undefined>,
    });
  }
  // (this.keyv.opts.store as KeyvRedis)?.redis;
  keyv.on('error', (e: any) => {
    console.error(e);
  });
  const reloadGlobalConfig = async (globalConfigField: keyof GlobalConfig) => {
    const pr = await keyv.get(`globalConfig:${globalConfigField}`);
    if (pr !== undefined) {
      globalConfig[globalConfigField] = pr;
    }
    await keyv.set(
      `globalConfig:${globalConfigField}`,
      globalConfig[globalConfigField]
    );
  };
  await reloadGlobalConfig('printSavePointEveryMessage');
  await reloadGlobalConfig('printTokensEveryMessage');

  await initRoleMode(keyv).loadFromJsonFile();

  // Initialize ChatGPT API.
  const api = new ChatGPT(config.api, keyv);
  await api.init();

  const bot = new BotBase(config, keyv);

  const botAuthenticate = new BotAuthenticate(bot.bot, keyv, config);
  await botAuthenticate.register();

  const botCmd = new BotCommand(bot.bot, api, keyv, config);
  await botCmd.register();

  const botChat = new BotChat(bot.bot, api, keyv, config);
  await botChat.register();

  await bot.finalStart();

  if (config.server.port) {
    console.log('start ServerApp');
    const serverApp = new ServerApp(
      keyv,
      api,
      config.server.host,
      config.server.port
    );
  }
}

main().catch((err) => {
  console.error(err.message);
  console.error(err.stack);
  process.exit(1);
});
