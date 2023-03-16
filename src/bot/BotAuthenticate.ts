import {Telegraf} from 'telegraf';
import Keyv from 'keyv';
import {Config} from '../types';
import {logWithTime} from '../utils';

export class BotAuthenticate {
  constructor(public bot: Telegraf, public keyv: Keyv, public config: Config) {
  }

  async register() {
    this.bot.use((ctx, next) => {
      switch (ctx.chat?.type) {
        case 'private':
          if (
            this.config.bot.userIds.find((T) => ctx.from?.id === T) !==
            undefined
          ) {
            return next();
          } else {
            const userInfo = `@${ctx.from?.username ?? ''} (${ctx.from?.id})`;
            logWithTime('⚠️ Authentication failed for user ' + userInfo);
            ctx.sendMessage(
              '⛔️ Sorry, you are not my owner. I cannot chat with you or execute your command.\n' +
              `chat id : ${ctx.chat.id}, user id : ${ctx.from?.id}`,
            );
            return;
          }
        case 'channel':
        case 'group':
        case 'supergroup':
          if (
            this.config.bot.groupIds.find((T) => ctx.chat?.id === T) !==
            undefined
          ) {
            if (
              this.config.bot.userIds.find((T) => ctx.from?.id === T) !==
              undefined
            ) {
              return next();
            }
          }
          logWithTime(
            `⚠️ Authentication failed for group ${ctx.chat?.title} (${ctx.chat?.id}).`,
          );
          ctx.sendMessage(
            '⛔️ Sorry, you are not my owner. I cannot chat with you or execute your command.\n' +
            `chat id : ${ctx.chat.id}, user id : ${ctx.from?.id}`,
          );
          ctx.sendMessage('i only work in private chat this time.');
          return;
      }
    });
  }
}
