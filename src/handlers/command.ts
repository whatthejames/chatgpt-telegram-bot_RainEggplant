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
import _ from 'lodash';
import {PatchedChatGPTAPI} from '../PatchChatGPTAPI';
import Keyv from 'keyv';

class CommandHandler {
  debug: number;
  protected _opts: BotOptions;
  protected _bot: TelegramBot;
  protected _api: ChatGPT;
  protected _keyv: Keyv;

  constructor(
    bot: TelegramBot,
    api: ChatGPT,
    keyv: Keyv,
    botOpts: BotOptions,
    debug = 1
  ) {
    this.debug = debug;
    this._bot = bot;
    this._api = api;
    this._keyv = keyv;
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
            '  • /reset 重置到全新的聊天上下文.\n' +
            '  • /reload (admin required) Refresh the ChatGPT session.\n' +
            '  • /hot_load_prompt_json  热加载prompt.json引导词文件，修改引导词文件文件后不需要重启整个服务啦.\n' +
            '系统角色配置（SystemMessage引导词）\n' +
            '  • /roles 列出所有角色 , 用这个指令列出所有可用的角色.\n' +
            '  • /role 显示当前的角色.\n' +
            '  • /role_info 当前角色的prompt引导词.\n' +
            '  • /system_custom 使用 [/system_custom 引导词] 来设置自定义(custom)角色的引导词，在切换到custom角色时使用该引导词.\n' +
            '  • /system_custom_clear 清空custom引导词\n' +
            `当前使用的角色是： ${getNowRole().role} [ /role_${
              getNowRole().shortName
            } ]\n` +
            '对话上下文\n' +
            '  • /get_context 获取当前聊天上下文的的存档点.\n' +
            '  • /print_save_point [开关]在每一条消息后显示存档点.\n' +
            '  •  •  • 可以通过直接发送存档点命令来回到指定的对话状态。\n' +
            '  •  •  • 默认存档的上下文信息保存在内存中，重启服务后失效。\n' +
            '  •  •  • 若redis数据库工作正常时存档的上下文信息会保存到redis数据库，服务重启后仍然可以使用保存的存档点。\n' +
            '最大 Tokens 设置\n' +
            '  • /get_max_response_tokens 显示最大回答 tokens.\n' +
            '  • /set_max_response_tokens 设置最大回答 tokens.\n' +
            '  • /get_max_model_tokens 显示最大模型 tokens.\n' +
            '  • /set_max_model_tokens 设置最大模型 tokens.\n' +
            '  •  •  • 在提示剩余token不足以生成回答时可以调小max_response_tokens并再次重新发送提问来避开限制\n' +
            '  •  •  • 调整max_response_tokens的大小也会影响回答的结果，越小越倾向于更简单的思考；越大越倾向于更加复杂的思考。调小可以避免过拟合，调大可以获得更复杂的角色扮演效果。\n' +
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
            `Context: \`/resetContext_${await this._api.getContext()}\` `,
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
        await this._keyv.set(
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
            if (_.isSafeInteger(n)) {
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
            if (_.isSafeInteger(n)) {
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
          const old = await this._api.getContext();
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
