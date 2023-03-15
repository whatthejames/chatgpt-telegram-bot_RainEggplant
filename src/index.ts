import TelegramBot from 'node-telegram-bot-api';
import {ChatGPT} from './api';
import {MessageHandler} from './handlers/message';
import {loadConfig} from './utils';
import Keyv, {Store} from 'keyv';
import QuickLRU from 'quick-lru';
import {globalConfig} from './GlobalConfig';
import {loadFromJsonFile} from './promptsRole';

let keyv: Keyv;

async function main() {
  const opts = loadConfig();

  await loadFromJsonFile();

  if (opts.redis && opts.redis.length > 0) {
    keyv = new Keyv(opts.redis);
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

  {
    const pr = await keyv.get('globalConfig:printSavePointEveryMessage');
    if (pr !== undefined) {
      globalConfig.printSavePointEveryMessage = pr;
    }
    await keyv.set(
      'globalConfig:printSavePointEveryMessage',
      globalConfig.printSavePointEveryMessage
    );
  }

  // Initialize ChatGPT API.
  const api = new ChatGPT(opts.api, keyv);
  await api.init();

  // Initialize Telegram Bot and message handler.
  const bot = new TelegramBot(opts.bot.token, {
    polling: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    request: {proxy: opts.proxy} as any,
  });
  const messageHandler = new MessageHandler(
    bot,
    api,
    keyv,
    opts.bot,
    opts.debug
  );
  await messageHandler.init();

  bot.on('message', messageHandler.handle);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
