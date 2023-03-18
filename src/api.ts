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
import {getRoleMode} from './PromptsRole';
import {ChatGPTAPIOptions} from 'chatgpt';
import {
  PatchedChatGPTAPI,
  SendMessageReturn,
  toPatchChatGPTAPI,
} from './PatchChatGPTAPI';

interface ChatContext {
  conversationId?: string;
  parentMessageId?: string;
}

interface ChatGPTSendMessageReturnType {
  res: ChatResponseV3 | SendMessageReturn;
  context: ChatContext;
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
  protected _apiOfficial: (ChatGPTAPI & PatchedChatGPTAPI) | undefined;
  protected _apiUnofficialProxy: ChatGPTUnofficialProxyAPI | undefined;
  protected _context: ChatContext = {};
  protected _timeoutMs: number | undefined;
  public keyv: Keyv;

  constructor(apiOpts: APIOptions, keyv: Keyv, debug = 1) {
    this.debug = debug;
    this.apiType = apiOpts.type;
    this._opts = apiOpts;
    this._timeoutMs = undefined;

    this.keyv = keyv;
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

  setMaxResponseTokens = (t: number) => {
    this._apiOfficial?.setMaxResponseTokens(t);
  };

  getMaxResponseTokens = (): number => {
    return this._apiOfficial?.getMaxResponseTokens() || 0;
  };

  setMaxModelTokens = (t: number) => {
    this._apiOfficial?.setMaxModelTokens(t);
  };

  getMaxModelTokens = (): number => {
    return this._apiOfficial?.getMaxModelTokens() || 0;
  };

  getCompletionParams = () => {
    return this._apiOfficial?.getCompletionParams();
  };

  init = async () => {
    await getRoleMode().loadCustomFromStorage();

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

      this._apiOfficial = toPatchChatGPTAPI(
        new ChatGPTAPI({
          ...this._opts.official,
          messageStore: this.keyv,
          debug: true,
          systemMessage: getRoleMode().getNowRolePrompt(),
          getMessageById: async (id: string) => {
            return this.getMessageById(id);
          },
          upsertMessage: async (message: ChatResponseV4) => {
            await this.upsertMessage(message);
          },
        } as ChatGPTAPIOptions)
      );

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
  ): Promise<ChatGPTSendMessageReturnType | undefined> => {
    if (!this._api) return;

    let res: ChatResponseV3 | SendMessageReturn;
    if (this.apiType == 'official') {
      if (!this._apiOfficial) return;
      if (getRoleMode().getNowRolePrompt()) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        (this._apiOfficial as PatchedChatGPTAPI)._systemMessage =
          getRoleMode().getNowRolePrompt()!;
      } else {
        const currentDate = new Date().toISOString().split('T')[0];
        // copy from lib https://github.com/transitive-bullshit/chatgpt-api/blob/main/src/chatgpt-api.ts
        (
          this._apiOfficial as PatchedChatGPTAPI
        )._systemMessage = `You are ChatGPT, a large language model trained by OpenAI. Answer as concisely as possible.
Knowledge cutoff: 2021-09-01
Current date: ${currentDate}`;
      }
      // console.log(
      //   '(this._apiOfficial as any)._systemMessage',
      //   (this._apiOfficial as any)._systemMessage,
      // );
      res = (await this._apiOfficial.sendMessage(text, {
        ...this._context,
        onProgress,
        timeoutMs: this._timeoutMs,
        systemMessage: getRoleMode().getNowRolePrompt(),
      })) as SendMessageReturn;
      console.log('res', [
        res.role,
        res.name,
        res.parentMessageId,
        res.conversationId,
        res.delta,
        res.detail,
      ]);
    } else {
      res = (await this._api.sendMessage(text, {
        ...this._context,
        onProgress,
        timeoutMs: this._timeoutMs,
      })) as ChatResponseV3;
    }

    const parentMessageId =
      this.apiType == 'browser'
        ? (res as ChatResponseV3).messageId
        : (res as ChatResponseV4).id;

    this._context = {
      conversationId: res.conversationId,
      parentMessageId: parentMessageId,
    };

    return {res: res, context: this._context} as ChatGPTSendMessageReturnType;
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

  async getContext() {
    let roleCustomSavePoint = '';
    const shortName = getRoleMode().getNowRole().shortName;
    if (shortName === 'custom') {
      roleCustomSavePoint = (await getRoleMode().saveCustomPoint()) || '';
    }
    return Buffer.from(
      `${this._context.conversationId || ''}:::${
        this._context.parentMessageId || ''
      }:::${shortName || ''}:::${roleCustomSavePoint}`
    ).toString('base64');
  }

  async resetContext(c: string) {
    try {
      const cc = Buffer.from(c, 'base64').toString('utf-8').split(':::');
      if (cc && cc.length < 2) {
        return undefined;
      }
      const conversationId = cc[0] && cc[0].length > 0 ? cc[0] : undefined;
      const parentMessageId = cc[1] && cc[1].length > 0 ? cc[1] : undefined;
      const roleShortName =
        cc.length >= 3 && cc[2] && cc[2].length > 0 ? cc[2] : undefined;
      const roleCustomSavePoint =
        cc.length >= 4 && cc[3] && cc[3].length > 0 ? cc[3] : undefined;
      if (!parentMessageId) {
        return undefined;
      }
      const m = await this.getMessageById(parentMessageId);
      if (!m) {
        return undefined;
      }
      this._context = {
        conversationId,
        parentMessageId,
      };
      if (roleShortName) {
        const n = getRoleMode().getRolesMap().get(roleShortName);
        if (n) {
          getRoleMode().setNowRole(n);
        }
      }
      if (
        roleShortName === 'custom' &&
        roleCustomSavePoint &&
        roleCustomSavePoint.length > 0
      ) {
        await getRoleMode().loadCustomPoint(roleCustomSavePoint);
      }
      return this._context;
    } catch (e) {
      console.error(e);
      return undefined;
    }
  }

  async exportMessageList() {
    if (this._context.parentMessageId) {
      return this._apiOfficial?.exportMessageList(
        this._context.parentMessageId,
        getRoleMode().getNowRolePrompt()
      );
    }
    return undefined;
  }
}

export {ChatGPT};
