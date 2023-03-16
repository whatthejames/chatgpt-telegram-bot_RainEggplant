import {Context, Telegraf} from 'telegraf';
import {message} from 'telegraf/filters';
import {Message, ReplyMessage, Update} from 'typegram';
import {ChatGPT} from '../api';
import Keyv from 'keyv';
import _ from 'lodash';
import {Config} from '../types';
import {logWithTime} from '../utils';
import Queue from 'promise-queue';
import {ChatMessage as ChatResponseV4} from 'chatgpt';
import type {ChatResponse as ChatResponseV3} from 'chatgpt-v3';
import {SendMessageReturn} from '../PatchChatGPTAPI';
import {globalConfig} from '../GlobalConfig';
import telegramifyMarkdown from 'telegramify-markdown';
import TextMessage = Message.TextMessage;

export class BotChat {
  protected _n_queued = 0;
  protected _n_pending = 0;
  protected _apiRequestsQueue = new Queue(1, Infinity);
  protected _positionInQueue: Record<string, number> = {};
  protected _updatePositionQueue = new Queue(20, Infinity);

  constructor(
    public bot: Telegraf,
    public gpt: ChatGPT,
    public keyv: Keyv,
    public config: Config
  ) {}

  protected _getQueueKey = (chatId: number, messageId: number) =>
    `${chatId}:${messageId}`;

  protected _parseQueueKey = (key: string) => {
    const [chat_id, message_id] = key.split(':');
    return {chat_id, message_id};
  };

  protected _updateQueue = async (chatId: number, messageId: number) => {
    // delete value for current request
    delete this._positionInQueue[this._getQueueKey(chatId, messageId)];
    if (this._n_queued > 0) this._n_queued--;
    else this._n_pending--;

    for (const key in this._positionInQueue) {
      const {chat_id, message_id} = this._parseQueueKey(key);
      this._positionInQueue[key]--;
      // ??? why not use await ?
      this._updatePositionQueue.add(() => {
        return this.bot.telegram.editMessageText(
          chat_id,
          _.parseInt(message_id),
          undefined,
          this._positionInQueue[key] > 0
            ? `⌛: You are #${this._positionInQueue[key]} in line.`
            : '🤔'
        );
      });
    }
  };

  async register() {
    this.bot.on(message('text'), async (ctx, next) => {
      // ctx.message.text;

      // const r = await ctx.sendMessage('');
      // await this.bot.telegram.editMessageText(
      //   ctx.chat.id,
      //   r.message_id,
      //   undefined,
      //   '',
      // );

      const text = ctx.message.text;
      const chatId = ctx.chat.id;
      if (this.config.debug >= 1) {
        const userInfo = `@${ctx.from?.username ?? ''} (${ctx.from?.id})`;
        const chatInfo =
          ctx.chat.type == 'private'
            ? 'private chat'
            : `group ${ctx.chat.title} (${ctx.chat.id})`;
        logWithTime(`📩 Message from ${userInfo} in ${chatInfo}:\n${text}`);
      }

      // Send a message to the chat acknowledging receipt of their message
      const reply: TextMessage = await ctx.reply('⌛');

      // add to sequence queue due to chatGPT processes only one request at a time
      const requestPromise = this._apiRequestsQueue.add(() => {
        return this._sendToGpt(text, chatId, reply);
      });
      if (this._n_pending == 0) this._n_pending++;
      else this._n_queued++;
      this._positionInQueue[this._getQueueKey(chatId, reply.message_id)] =
        this._n_queued;

      await this.bot.telegram.editMessageText(
        chatId,
        reply.message_id,
        undefined,
        this._n_queued > 0 ? `⌛: You are #${this._n_queued} in line.` : '🤔'
      );
      await requestPromise;
    });
  }

  protected _sendToGpt = async (
    text: string,
    chatId: number,
    originalReply: TextMessage
  ) => {
    let reply = originalReply;
    await this.bot.telegram.sendChatAction(chatId, 'typing');

    // Send message to ChatGPT
    try {
      const res = await this.gpt.sendMessage(
        text,
        _.throttle(
          async (partialResponse: ChatResponseV3 | ChatResponseV4) => {
            const resText =
              this.gpt.apiType == 'browser'
                ? (partialResponse as ChatResponseV3).response
                : (partialResponse as ChatResponseV4).text;
            reply = await this._editMessage(reply, resText);
            await this.bot.telegram.sendChatAction(chatId, 'typing');
          },
          3000,
          {leading: true, trailing: false}
        )
      );

      if (
        res &&
        (res.res as SendMessageReturn).numTokens &&
        (res.res as SendMessageReturn).maxTokens
      ) {
        await this.bot.telegram.sendMessage(
          chatId,
          `numTokens : ${(res.res as SendMessageReturn).numTokens} , ` +
            `maxTokens : ${(res.res as SendMessageReturn).maxTokens} `
        );
      }
      if (globalConfig.printSavePointEveryMessage) {
        await this.bot.telegram.sendMessage(
          chatId,
          `SavePoint: \`/resetContext_${await this.gpt.getContext()}\` `,
          {parse_mode: 'MarkdownV2'}
        );
      }

      const resText =
        this.gpt.apiType == 'browser'
          ? (res?.res as ChatResponseV3).response
          : (res?.res as ChatResponseV4).text;
      await this._editMessage(reply, resText);

      if (this.config.debug >= 1) logWithTime(`📨 Response:\n${resText}`);
    } catch (err) {
      logWithTime('⛔️ ChatGPT API error:', (err as Error).message);
      await this.bot.telegram.sendMessage(
        chatId,
        "⚠️ Sorry, I'm having trouble connecting to the server, please try again later."
      );
      await this.bot.telegram.sendMessage(chatId, (err as Error).message);
    }

    // Update queue order after finishing current request
    await this._updateQueue(chatId, reply.message_id);
  };

  // Edit telegram message
  protected _editMessage = async (
    msg: TextMessage,
    text: string,
    needParse = true
  ) => {
    if (text.trim() === '' || msg.text === text) {
      return msg;
    }
    try {
      text = telegramifyMarkdown(text, 'escape');
      const res = await this.bot.telegram.editMessageText(
        msg.chat.id,
        msg.message_id,
        undefined,
        text,
        {
          parse_mode: needParse ? 'MarkdownV2' : undefined,
        }
      );
      // type of res is boolean | Message
      if (typeof res === 'object') {
        // return a Message type instance if res is a Message type
        return res;
      } else {
        // return the original message if res is a boolean type
        return msg;
      }
    } catch (err) {
      logWithTime('⛔️ Edit message error:', (err as Error).message);
      if (this.config.debug >= 2) logWithTime('⛔️ Message text:', text);
      return msg;
    }
  };
}
