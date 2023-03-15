import type TelegramBot from 'node-telegram-bot-api';
import type {ChatGPT} from '../api';
import {BotOptions} from '../types';
import {logWithTime} from '../utils';
import {
  getNowRole,
  getRolePrompt,
  loadCustomFromStorage,
  loadFromJsonFile,
  roles,
  rolesMap,
  saveCustomFrom,
  setCustom,
  setNowRole,
} from '../promptsRole';
import {globalConfig} from '../GlobalConfig';
import lodash from 'lodash';
import {PatchedChatGPTAPI} from '../PatchChatGPTAPI';

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

    let text = msg.text ?? '';
    for (const entity of msg.entities ?? []) {
      if (entity.type == 'bot_command' && entity.offset == 0) {
        text = msg.text?.slice(entity.length).trim() ?? '';
      }
    }

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
            '  • /reload (admin required) Refresh the ChatGPT session.\n' +
            '  • /hot_load_prompt_json  hot load prompt.json file.\n' +
            'System Role Config\n' +
            '  • /roles list all roles , use this to list all available roles.\n' +
            '  • /role now role.\n' +
            '  • /role_info more now role info.\n' +
            '  • /system_custom use [/system_custom prompts] to set custom prompts.\n' +
            '  • /system_custom_clear clear custom prompts\n' +
            `now role is ${getNowRole().role} [ /role_${
              getNowRole().shortName
            } ]\n` +
            'Conversation Context\n' +
            '  • /get_context get a save point for Context.\n' +
            '  • /print_save_point print Save Point Every Message.\n' +
            'Max Tokens\n' +
            '  • /get_max_response_tokens get max response tokens.\n' +
            '  • /set_max_response_tokens set max response tokens.\n' +
            '  • /get_max_model_tokens get max model tokens.\n' +
            '  • /set_max_model_tokens set max model tokens.\n' +
            ''
        );
        break;

      case '/hot_load_prompt_json':
        await loadFromJsonFile();
        await loadCustomFromStorage(this._api.keyv);
        await this._bot.sendMessage(msg.chat.id, 'ok');
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

      case '/role_info':
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

      case '/get_context':
        await this._bot.sendMessage(
          msg.chat.id,
          'you can use follow cmd to restore conversation\\.\n' +
            'you can restore conversation after server restart only if redis work well\\.\n' +
            `Context: \`/resetContext_${this._api.getContext()}\` `,
          {parse_mode: 'MarkdownV2'}
        );
        break;

      case '/print_save_point':
        globalConfig.printSavePointEveryMessage =
          !globalConfig.printSavePointEveryMessage;
        await this._bot.sendMessage(
          msg.chat.id,
          `now printSavePointEveryMessage is: ${globalConfig.printSavePointEveryMessage}`
        );
        await this._api.keyv.set(
          'globalConfig:printSavePointEveryMessage',
          globalConfig.printSavePointEveryMessage
        );
        break;

      case '/system_custom':
        {
          if (text && text.length > 0) {
            await setCustom(text, this._api.keyv);
            await this._bot.sendMessage(msg.chat.id, `ok`);
          } else {
            await this._bot.sendMessage(msg.chat.id, `failed`);
          }
        }
        break;

      case '/system_custom_clear':
        await setCustom('', this._api.keyv);
        await this._bot.sendMessage(msg.chat.id, `ok`);
        break;

      case '/get_max_response_tokens':
        await this._bot.sendMessage(
          msg.chat.id,
          `now MaxResponseTokens is ${this._api.getMaxResponseTokens()}`
        );
        break;

      case '/set_max_response_tokens':
        {
          if (text && text.length > 0) {
            const n = parseInt(text);
            if (lodash.isSafeInteger(n)) {
              await this._api.setMaxResponseTokens(n);
              await this._bot.sendMessage(
                msg.chat.id,
                `ok. now MaxResponseTokens is ${this._api.getMaxResponseTokens()}`
              );
              break;
            }
          }
          await this._bot.sendMessage(msg.chat.id, `failed`);
        }
        break;

      case '/get_max_model_tokens':
        await this._bot.sendMessage(
          msg.chat.id,
          `now MaxModelTokens is ${this._api.getMaxModelTokens()}`
        );
        break;

      case '/set_max_model_tokens':
        {
          if (text && text.length > 0) {
            const n = parseInt(text);
            if (lodash.isSafeInteger(n)) {
              await this._api.setMaxModelTokens(n);
              await this._bot.sendMessage(
                msg.chat.id,
                `ok. now MaxModelTokens is ${this._api.getMaxModelTokens()}`
              );
              break;
            }
          }
          await this._bot.sendMessage(msg.chat.id, `failed`);
        }
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
        if (command.startsWith('/resetContext_')) {
          const old = this._api.getContext();
          const cc = command.replace(/^\/resetContext_/, '');
          if (await this._api.resetContext(cc)) {
            await this._bot.sendMessage(
              msg.chat.id,
              `resetContext ok,\nthe old Context is: \`/resetContext_${old}\` `,
              {parse_mode: 'MarkdownV2'}
            );
          } else {
            await this._bot.sendMessage(msg.chat.id, `resetContext failed.`);
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
