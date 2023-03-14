import type {
  ChatGPTAPI,
  ChatGPTUnofficialProxyAPI,
  ChatMessage as ChatResponseV4,
} from 'chatgpt';
import type {
  ChatGPTAPIBrowser,
  ChatResponse as ChatResponseV3,
} from 'chatgpt-v3';
import {
  APIBrowserOptions,
  APIOfficialOptions,
  APIOptions,
  APIUnofficialOptions,
} from './types';
import {logWithTime} from './utils';
import Keyv from 'keyv';
// import KeyvRedis from '@keyv/redis';
import {getNowRole, getRolePrompt} from './promptsRole';
import {ChatGPTAPIOptions} from 'chatgpt';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import QuickLRU from 'quick-lru';

interface ChatContext {
  conversationId?: string;
  parentMessageId?: string;
}

class ChatGPT {
  debug: number;
  readonly apiType: string;
  protected _opts: APIOptions;
  protected _api:
    | ChatGPTAPI
    | ChatGPTAPIBrowser
    | ChatGPTUnofficialProxyAPI
    | undefined;
  protected _apiBrowser: ChatGPTAPIBrowser | undefined;
  protected _apiOfficial: ChatGPTAPI | undefined;
  protected _apiUnofficialProxy: ChatGPTUnofficialProxyAPI | undefined;
  protected _context: ChatContext = {};
  protected _timeoutMs: number | undefined;
  protected keyv: Keyv;

  constructor(apiOpts: APIOptions, databasePath = '', debug = 1) {
    this.debug = debug;
    this.apiType = apiOpts.type;
    this._opts = apiOpts;
    this._timeoutMs = undefined;

    if (databasePath.length > 0) {
      this.keyv = new Keyv(databasePath);
    } else {
      // same as npm chatgpt package
      this.keyv = new Keyv({
        store: new QuickLRU({maxSize: 1e4}),
      });
    }
    // (this.keyv.opts.store as KeyvRedis)?.redis;
    this.keyv.on('error', (e: any) => {
      console.error(e);
    });
  }

  getMessageById = async (id: string): Promise<ChatResponseV4 | undefined> => {
    const m = await this.keyv.get(id);
    console.log('getMessageById id:', id, m);
    return m;
  };

  upsertMessage = async (message: ChatResponseV4) => {
    console.log('upsertMessage message:', message);
    await this.keyv.set(message.id, message);
  };

  init = async () => {
    if (this._opts.type == 'browser') {
      const {ChatGPTAPIBrowser} = await import('chatgpt-v3');
      this._apiBrowser = new ChatGPTAPIBrowser(
        this._opts.browser as APIBrowserOptions
      );
      await this._apiBrowser.initSession();
      this._api = this._apiBrowser;
      this._timeoutMs = this._opts.browser?.timeoutMs;
    } else if (this._opts.type == 'official') {
      const {ChatGPTAPI} = await import('chatgpt');

      this._apiOfficial = new ChatGPTAPI({
        ...this._opts.official,
        messageStore: this.keyv,
        debug: true,
        systemMessage: getRolePrompt(getNowRole()),
        getMessageById: async (id: string) => {
          return this.getMessageById(id);
        },
        upsertMessage: async (message: ChatResponseV4) => {
          await this.upsertMessage(message);
        },
      } as ChatGPTAPIOptions);
      this._api = this._apiOfficial;
      this._timeoutMs = this._opts.official?.timeoutMs;
    } else if (this._opts.type == 'unofficial') {
      const {ChatGPTUnofficialProxyAPI} = await import('chatgpt');
      this._apiUnofficialProxy = new ChatGPTUnofficialProxyAPI(
        this._opts.unofficial as APIUnofficialOptions
      );
      this._api = this._apiUnofficialProxy;
      this._timeoutMs = this._opts.unofficial?.timeoutMs;
    } else {
      throw new RangeError('Invalid API type');
    }
    logWithTime('🔮 ChatGPT API has started...');
  };

  sendMessage = async (
    text: string,
    onProgress?: (res: ChatResponseV3 | ChatResponseV4) => void
  ) => {
    if (!this._api) return;

    let res: ChatResponseV3 | ChatResponseV4;
    if (this.apiType == 'official') {
      if (!this._apiOfficial) return;
      if (getRolePrompt(getNowRole())) {
        (this._apiOfficial as any)._systemMessage = getRolePrompt(getNowRole());
      }
      // console.log(
      //   '(this._apiOfficial as any)._systemMessage',
      //   (this._apiOfficial as any)._systemMessage,
      // );
      res = await this._apiOfficial.sendMessage(text, {
        ...this._context,
        onProgress,
        timeoutMs: this._timeoutMs,
        systemMessage: getRolePrompt(getNowRole()),
      });
      console.log('res', [
        res.role,
        res.name,
        res.parentMessageId,
        res.conversationId,
        res.delta,
        res.detail,
      ]);
    } else {
      res = await this._api.sendMessage(text, {
        ...this._context,
        onProgress,
        timeoutMs: this._timeoutMs,
      });
    }

    const parentMessageId =
      this.apiType == 'browser'
        ? (res as ChatResponseV3).messageId
        : (res as ChatResponseV4).id;

    this._context = {
      conversationId: res.conversationId,
      parentMessageId: parentMessageId,
    };

    return res;
  };

  resetThread = async () => {
    if (this._apiBrowser) {
      await this._apiBrowser.resetThread();
    }
    this._context = {};
  };

  refreshSession = async () => {
    if (this._apiBrowser) {
      await this._apiBrowser.refreshSession();
    }
  };

  getContext() {
    return Buffer.from(
      `${this._context.conversationId || ''}:::${
        this._context.parentMessageId || ''
      }`
    ).toString('base64');
  }

  async resetContext(c: string) {
    try {
      const cc = Buffer.from(c, 'base64').toString('utf-8').split(':::');
      if (cc && cc.length !== 2) {
        return false;
      }
      const conversationId = cc[0] && cc[0].length > 0 ? cc[0] : undefined;
      const parentMessageId = cc[1] && cc[1].length > 0 ? cc[1] : undefined;
      if (!parentMessageId) {
        return false;
      }
      const m = await this.getMessageById(parentMessageId);
      if (!m) {
        return false;
      }
      this._context = {
        conversationId,
        parentMessageId,
      };
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }
}

export {ChatGPT};
