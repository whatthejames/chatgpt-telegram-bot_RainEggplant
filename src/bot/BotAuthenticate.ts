import {Telegraf} from 'telegraf';
import _ from 'lodash';
import Keyv from 'keyv';
import {Config} from '../types';
import {logWithTime} from '../utils';
import {ExtendedContext} from './BotBase';

export class BotAuthenticate {
  constructor(
    public bot: Telegraf<ExtendedContext>,
    public keyv: Keyv,
    public config: Config
  ) {}

  async register() {
    const rememberChat = async (chatId: number) => {
      let L: number[] | undefined = await this.keyv.get(
        `ChatGptTelegraf:InChat`
      );
      L = _.isArray(L) ? L : [];
      if (!L.find((T) => T === chatId)) {
        L.push(chatId);
        await this.keyv.set(`ChatGptTelegraf:InChat`, L);
      }
    };
    this.bot.use(async (ctx, next) => {
      switch (ctx.chat?.type) {
        case 'private':
          if (
            ctx.from &&
            ctx.chat &&
            this.config.bot.userIds.find((T) => ctx.from?.id === T) !==
              undefined
          ) {
            await rememberChat(ctx.from.id);

            return next();
          } else {
            const userInfo = `@${ctx.from?.username ?? ''} (${ctx.from?.id})`;
            logWithTime('⚠️ Authentication failed for user ' + userInfo);
            await ctx.sendMessage(
              '⛔️ Sorry, you are not my owner. I cannot chat with you or execute your command.\n' +
                `chat id : ${ctx.chat.id}, user id : ${ctx.from?.id}`
            );
            return;
          }
        case 'channel':
        case 'group':
        case 'supergroup':
          if (
            ctx.chat &&
            this.config.bot.groupIds.find((T) => ctx.chat?.id === T) !==
              undefined
          ) {
            if (
              ctx.from &&
              this.config.bot.userIds.find((T) => ctx.from?.id === T) !==
                undefined
            ) {
              await rememberChat(ctx.from.id);

              return next();
            }
          }
          logWithTime(
            `⚠️ Authentication failed for group ${ctx.chat?.title} (${ctx.chat?.id}).`
          );
          await ctx.sendMessage(
            '⛔️ Sorry, you are not my owner. I cannot chat with you or execute your command.\n' +
              `chat id : ${ctx.chat.id}, user id : ${ctx.from?.id}`
          );
          await ctx.sendMessage('i only work in private chat this time.');
          return;
      }
    });
  }
}
