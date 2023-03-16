import {Telegraf} from 'telegraf';
import {message} from 'telegraf/filters';
import {ChatGPT} from '../api';
import Keyv from 'keyv';
import {Config} from '../types';
import {
  getNowRole,
  getRolePrompt,
  loadCustomFromStorage,
  loadFromJsonFile,
  roles,
  rolesMap,
  setCustom,
  setNowRole,
} from '../promptsRole';
import {logWithTime} from '../utils';
import {globalConfig} from '../GlobalConfig';
import _ from 'lodash';

export class BotCommand {
  constructor(
    public bot: Telegraf,
    public gpt: ChatGPT,
    public keyv: Keyv,
    public config: Config
  ) {}

  async register() {
    this.bot.help(async (ctx, next) => {
      await ctx.sendMessage(
        'To chat with me, you can:\n' +
          '  • send messages directly (not supported in groups)\n' +
          `  • send messages that start with ${this.config.bot.chatCmd}\n` +
          '  • reply to my last message\n\n' +
          'Command list:\n' +
          `(When using a command in a group, make sure to include a mention after the command, like /help@${this.bot.botInfo?.username}).\n` +
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
    });

    this.bot.command('hot_load_prompt_json', async (ctx, next) => {
      await loadFromJsonFile();
      await loadCustomFromStorage(this.gpt.keyv);
      await ctx.sendMessage('ok');
    });

    this.bot.command('roles', async (ctx, next) => {
      await ctx.sendMessage(
        'roles \n' +
          `${roles
            .map((T) => `${T.role} [ /role_${T.shortName} ]`)
            .join('\n')}\n` +
          `now role is ${getNowRole().role} [ /role_${getNowRole().shortName} ]`
      );
    });

    this.bot.command('role', async (ctx, next) => {
      await ctx.sendMessage(
        `now role is ${getNowRole().role} [ /role_${getNowRole().shortName} ]`
      );
    });
    this.bot.command('role_info', async (ctx, next) => {
      await ctx.sendMessage(
        `now role is ${getNowRole().role} [ /role_${getNowRole().shortName} ]`
      );
      const pp = getRolePrompt(getNowRole())
        ? 'prompt:\n' + getRolePrompt(getNowRole())
        : 'no prompt';
      if (pp.length < 4096) {
        await ctx.sendMessage(pp);
      } else {
        // https://stackoverflow.com/a/7033662/3548568
        const l = pp.match(/(.|[\r\n]){1,4000}/g);
        if (l) {
          for (const s of l) {
            await ctx.sendMessage(s);
          }
        }
      }
    });

    this.bot.command('reset', async (ctx, next) => {
      await ctx.sendChatAction('typing');
      await this.gpt.resetThread();
      await ctx.sendMessage(
        '🔄 The chat thread has been reset. New chat thread started.'
      );
      const userInfo = `@${ctx.from?.username ?? ''} (${ctx.from?.id})`;
      logWithTime(`🔄 Chat thread reset by ${userInfo}.`);
    });

    this.bot.command('get_context', async (ctx, next) => {
      await ctx.sendMessage(
        'you can use follow cmd to restore conversation\\.\n' +
          'you can restore conversation after server restart only if redis work well\\.\n' +
          `Context: \`/resetContext_${await this.gpt.getContext()}\` `,
        {parse_mode: 'MarkdownV2'}
      );
    });

    this.bot.command('print_save_point', async (ctx, next) => {
      globalConfig.printSavePointEveryMessage =
        !globalConfig.printSavePointEveryMessage;
      await ctx.sendMessage(
        `now printSavePointEveryMessage is: ${globalConfig.printSavePointEveryMessage}`
      );
      await this.keyv.set(
        'globalConfig:printSavePointEveryMessage',
        globalConfig.printSavePointEveryMessage
      );
    });

    this.bot.command('system_custom', async (ctx, next) => {
      const text = ctx.message.text;
      if (text && text.length > 0) {
        await setCustom(text, this.gpt.keyv);
        await ctx.sendMessage(`ok`);
      } else {
        await ctx.sendMessage(`failed`);
      }
    });

    this.bot.command('system_custom_clear', async (ctx, next) => {
      await setCustom('', this.gpt.keyv);
      await ctx.sendMessage(`ok`);
    });

    this.bot.command('get_max_response_tokens', async (ctx, next) => {
      await ctx.sendMessage(
        `now MaxResponseTokens is ${this.gpt.getMaxResponseTokens()}`
      );
    });

    this.bot.command('set_max_response_tokens', async (ctx, next) => {
      const text = ctx.message.text;
      if (text && text.length > 0) {
        const n = parseInt(text);
        if (_.isSafeInteger(n)) {
          await this.gpt.setMaxResponseTokens(n);
          await ctx.sendMessage(
            `ok. now MaxResponseTokens is ${this.gpt.getMaxResponseTokens()}`
          );
        }
      }
      await ctx.sendMessage(`failed`);
    });

    this.bot.command('get_max_model_tokens', async (ctx, next) => {
      await ctx.sendMessage(
        `now MaxModelTokens is ${this.gpt.getMaxModelTokens()}`
      );
    });

    this.bot.command('set_max_model_tokens', async (ctx, next) => {
      const text = ctx.message.text;
      if (text && text.length > 0) {
        const n = parseInt(text);
        if (_.isSafeInteger(n)) {
          await this.gpt.setMaxModelTokens(n);
          await ctx.sendMessage(
            `ok. now MaxModelTokens is ${this.gpt.getMaxModelTokens()}`
          );
        }
      }
      await ctx.sendMessage(`failed`);
    });

    this.bot.command('reload', async (ctx, next) => {
      const userInfo = `@${ctx.from?.username ?? ''} (${ctx.from?.id})`;
      if (this.config.bot.userIds.indexOf(ctx.from?.id ?? 0) == -1) {
        await ctx.sendMessage(
          '⛔️ Sorry, you do not have the permission to run this command.'
        );
        logWithTime(
          `⚠️ Permission denied for "${'/reload'}" from ${userInfo}.`
        );
      } else {
        await ctx.sendChatAction('typing');
        await this.gpt.refreshSession();
        await ctx.sendMessage('🔄 Session refreshed.');
        logWithTime(`🔄 Session refreshed by ${userInfo}.`);
      }
    });

    this.bot.use(async (ctx, next) => {
      if (!ctx.message) {
        return next();
      }
      if (!('text' in ctx.message)) {
        return next();
      }
      if (ctx.message.text.startsWith('/role_')) {
        const ro = ctx.message.text.replace(/^\/role_/, '');
        const rn = rolesMap.get(ro);
        if (rn) {
          setNowRole(rn);
          await ctx.sendMessage(
            `now role is ${getNowRole().role} [ /role_${
              getNowRole().shortName
            } ]`
          );
        } else {
          await ctx.sendMessage(
            `invalid role. now role is ${getNowRole().role} [ /role_${
              getNowRole().shortName
            } ]`
          );
        }
        // ok, this message we processed
        return;
      }
      if (ctx.message.text.startsWith('/resetContext_')) {
        const old = await this.gpt.getContext();
        const cc = ctx.message.text.replace(/^\/resetContext_/, '');
        if (await this.gpt.resetContext(cc)) {
          await ctx.sendMessage(
            `resetContext ok,\nthe old Context is: \`/resetContext_${old}\` `,
            {parse_mode: 'MarkdownV2'}
          );
        } else {
          await ctx.sendMessage(`resetContext failed.`);
        }
        // ok, this message we processed
        return;
      }
      // no, we are not care about this message
      return next();
    });

    // this.bot.command('cmd', async (ctx, next) => {
    // });
  }
}
