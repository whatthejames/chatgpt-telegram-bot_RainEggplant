import type TelegramBot from 'node-telegram-bot-api';
import type {ChatGPT} from '../api';
import {BotOptions} from '../types';
import {logWithTime} from '../utils';
import {
  getNowRole,
  getRolePrompt,
  roles,
  rolesMap,
  setNowRole,
} from '../promptsRole';

class CommandHandler {
  debug: number;
  protected _opts: BotOptions;
  protected _bot: TelegramBot;
  protected _api: ChatGPT;

  constructor(bot: TelegramBot, api: ChatGPT, botOpts: BotOptions, debug = 1) {
    this.debug = debug;
    this._bot = bot;
    this._api = api;
    this._opts = botOpts;
  }

  handle = async (
    msg: TelegramBot.Message,
    command: string,
    isMentioned: boolean,
    botUsername: string
  ) => {
    const userInfo = `@${msg.from?.username ?? ''} (${msg.from?.id})`;
    const chatInfo =
      msg.chat.type == 'private'
        ? 'private chat'
        : `group ${msg.chat.title} (${msg.chat.id})`;
    if (this.debug >= 1) {
      logWithTime(
        `👨‍💻️ User ${userInfo} issued command "${command}" in ${chatInfo} (isMentioned=${isMentioned}).`
      );
    }

    // Ignore commands without mention in groups.
    if (msg.chat.type != 'private' && !isMentioned) return;

    switch (command) {
      case '/help':
        await this._bot.sendMessage(
          msg.chat.id,
          'To chat with me, you can:\n' +
            '  • send messages directly (not supported in groups)\n' +
            `  • send messages that start with ${this._opts.chatCmd}\n` +
            '  • reply to my last message\n\n' +
            'Command list:\n' +
            `(When using a command in a group, make sure to include a mention after the command, like /help@${botUsername}).\n` +
            '  • /help Show help information.\n' +
            '  • /reset Reset the current chat thread and start a new one.\n' +
            '  • /reload (admin required) Refresh the ChatGPT session.' +
            'System Role Config\n' +
            '  • /roles list all roles , use this to list all available roles.\n' +
            '  • /role now role.\n' +
            '  • /roleInfo more now role info.\n' +
            `now role is ${getNowRole().role} [ /role_${
              getNowRole().shortName
            } ]\n` +
            ''
        );
        break;

      case '/roles':
        await this._bot.sendMessage(
          msg.chat.id,
          'roles \n' +
            `${roles
              .map((T) => `${T.role} [ /role_${T.shortName} ]`)
              .join('\n')}\n` +
            `now role is ${getNowRole().role} [ /role_${
              getNowRole().shortName
            } ]`
        );
        break;

      case '/role':
        await this._bot.sendMessage(
          msg.chat.id,
          `now role is ${getNowRole().role} [ /role_${getNowRole().shortName} ]`
        );
        break;

      case '/roleInfo':
        await this._bot.sendMessage(
          msg.chat.id,
          `now role is ${getNowRole().role} [ /role_${getNowRole().shortName} ]`
        );
        await this._bot.sendMessage(
          msg.chat.id,
          getRolePrompt(getNowRole())
            ? 'prompt:\n' + getRolePrompt(getNowRole())
            : 'no prompt'
        );
        break;

      case '/reset':
        await this._bot.sendChatAction(msg.chat.id, 'typing');
        await this._api.resetThread();
        await this._bot.sendMessage(
          msg.chat.id,
          '🔄 The chat thread has been reset. New chat thread started.'
        );
        logWithTime(`🔄 Chat thread reset by ${userInfo}.`);
        break;

      case '/reload':
        if (this._opts.userIds.indexOf(msg.from?.id ?? 0) == -1) {
          await this._bot.sendMessage(
            msg.chat.id,
            '⛔️ Sorry, you do not have the permission to run this command.'
          );
          logWithTime(
            `⚠️ Permission denied for "${command}" from ${userInfo}.`
          );
        } else {
          await this._bot.sendChatAction(msg.chat.id, 'typing');
          await this._api.refreshSession();
          await this._bot.sendMessage(msg.chat.id, '🔄 Session refreshed.');
          logWithTime(`🔄 Session refreshed by ${userInfo}.`);
        }
        break;

      default:
        if (command.startsWith('/role_')) {
          const ro = command.replace(/^\/role_/, '');
          const rn = rolesMap.get(ro);
          if (rn) {
            setNowRole(rn);
            await this._bot.sendMessage(
              msg.chat.id,
              `now role is ${getNowRole().role} [ /role_${
                getNowRole().shortName
              } ]`
            );
          } else {
            await this._bot.sendMessage(
              msg.chat.id,
              `invalid role. now role is ${getNowRole().role} [ /role_${
                getNowRole().shortName
              } ]`
            );
          }
          break;
        }
        await this._bot.sendMessage(
          msg.chat.id,
          '⚠️ Unsupported command. Run /help to see the usage.'
        );
        break;
    }
  };
}

export {CommandHandler};
