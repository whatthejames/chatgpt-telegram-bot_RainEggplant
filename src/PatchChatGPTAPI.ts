import {
  ChatGPTAPI,
  ChatGPTError,
  ChatMessage,
  FetchFn,
  GetMessageByIdFunction,
  openai,
  SendMessageOptions,
  UpsertMessageFunction,
} from 'chatgpt';
import {getNowRole} from './promptsRole';
import pTimeout from 'p-timeout';
import {v4 as uuidv4} from 'uuid';
import {createParser} from 'eventsource-parser';

export interface PatchedChatGPTAPI {
  _buildMessages(
    text: string,
    opts: SendMessageOptions
  ): Promise<{
    messages: openai.ChatCompletionRequestMessage[];
    maxTokens: number;
    numTokens: number;
  }>;

  sendMessage(text: string, opts?: SendMessageOptions): Promise<ChatMessage>;

  _getTokenCount(text: string): Promise<number>;

  _debug: boolean;
  _maxModelTokens: number;
  _maxResponseTokens: number;
  _systemMessage: string;
  _apiKey: string;
  _apiBaseUrl: string;
  _fetch: FetchFn;
  _getMessageById: GetMessageByIdFunction;
  _upsertMessage: UpsertMessageFunction;
  _completionParams: Omit<openai.CreateChatCompletionRequest, 'messages' | 'n'>;
}

const CHATGPT_MODEL = 'gpt-3.5-turbo';
const USER_LABEL_DEFAULT = 'User';
const ASSISTANT_LABEL_DEFAULT = 'ChatGPT';

export const toPatchChatGPTAPI = (api: ChatGPTAPI) => {
  const RRR = api as unknown as PatchedChatGPTAPI &
    Pick<ChatGPTAPI, 'sendMessage' | 'apiKey'>;

  RRR._buildMessages = async function _buildMessages(
    text: string,
    opts: SendMessageOptions
  ) {
    const {systemMessage = this._systemMessage} = opts;
    let {parentMessageId} = opts;

    const userLabel = USER_LABEL_DEFAULT;
    const assistantLabel = getNowRole().prompt
      ? getNowRole().role || ASSISTANT_LABEL_DEFAULT
      : ASSISTANT_LABEL_DEFAULT;

    const maxNumTokens = this._maxModelTokens - this._maxResponseTokens;
    let messages: openai.ChatCompletionRequestMessage[] = [];

    if (systemMessage) {
      messages.push({
        role: 'system',
        content: systemMessage,
      });
    }

    const systemMessageOffset = messages.length;
    let nextMessages = text
      ? messages.concat([
          {
            role: 'user',
            content: text,
            name: opts.name,
          },
        ])
      : messages;
    let numTokens = 0;

    do {
      const prompt = nextMessages
        .reduce((prompt, message) => {
          switch (message.role) {
            case 'system':
              return prompt.concat([`Instructions:\n${message.content}`]);
            case 'user':
              return prompt.concat([`${userLabel}:\n${message.content}`]);
            default:
              return prompt.concat([`${assistantLabel}:\n${message.content}`]);
          }
        }, [] as string[])
        .join('\n\n');

      const nextNumTokensEstimate = await this._getTokenCount(prompt);
      const isValidPrompt = nextNumTokensEstimate <= maxNumTokens;

      if (prompt && !isValidPrompt) {
        break;
      }

      messages = nextMessages;
      numTokens = nextNumTokensEstimate;

      if (!isValidPrompt) {
        break;
      }

      if (!parentMessageId) {
        break;
      }

      const parentMessage = await this._getMessageById(parentMessageId);
      if (!parentMessage) {
        break;
      }

      const parentMessageRole = parentMessage.role || 'user';

      nextMessages = nextMessages.slice(0, systemMessageOffset).concat([
        {
          role: parentMessageRole,
          content: parentMessage.text,
          name: parentMessage.name,
        },
        ...nextMessages.slice(systemMessageOffset),
      ]);

      parentMessageId = parentMessage.parentMessageId;
      // eslint-disable-next-line no-constant-condition
    } while (true);

    // Use up to 4096 tokens (prompt + response), but try to leave 1000 tokens
    // for the response.
    const maxTokens = Math.max(
      1,
      Math.min(this._maxModelTokens - numTokens, this._maxResponseTokens)
    );

    return {messages, maxTokens, numTokens};
  };

  RRR.sendMessage = async function sendMessage(
    text: string,
    opts: SendMessageOptions = {}
  ): Promise<ChatMessage> {
    const {
      parentMessageId,
      messageId = uuidv4(),
      timeoutMs,
      onProgress,
      stream = onProgress ? true : false,
    } = opts;

    let {abortSignal} = opts;

    let abortController: AbortController | undefined = undefined;
    if (timeoutMs && !abortSignal) {
      abortController = new AbortController();
      abortSignal = abortController.signal;
    }

    const message: ChatMessage = {
      role: 'user',
      id: messageId,
      parentMessageId,
      text,
    };
    await this._upsertMessage(message);

    const {messages, maxTokens, numTokens} = await this._buildMessages(
      text,
      opts
    );

    const result: ChatMessage = {
      role: 'assistant',
      id: uuidv4(),
      parentMessageId: messageId,
      text: '',
    };

    const responseP = new Promise<ChatMessage>(
      // eslint-disable-next-line no-async-promise-executor
      async (resolve, reject) => {
        const url = `${this._apiBaseUrl}/v1/chat/completions`;
        const headers = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this._apiKey}`,
        };
        const body = {
          max_tokens: maxTokens,
          ...this._completionParams,
          messages,
          stream,
        };

        if (this._debug) {
          console.log(`sendMessage (${numTokens} tokens)`, body);
        }

        if (stream) {
          fetchSSE(
            url,
            {
              method: 'POST',
              headers,
              body: JSON.stringify(body),
              signal: abortSignal,
              onMessage: (data: string) => {
                if (data === '[DONE]') {
                  result.text = result.text.trim();
                  return resolve(result);
                }

                try {
                  const response: openai.CreateChatCompletionDeltaResponse =
                    JSON.parse(data);

                  if (response.id) {
                    result.id = response.id;
                  }

                  if (response?.choices?.length) {
                    const delta = response.choices[0].delta;
                    result.delta = delta.content;
                    if (delta?.content) result.text += delta.content;
                    result.detail = response;

                    if (delta.role) {
                      result.role = delta.role;
                    }

                    onProgress?.(result);
                  }
                } catch (err) {
                  console.warn('OpenAI stream SEE event unexpected error', err);
                  return reject(err);
                }
              },
            },
            this._fetch
          ).catch(reject);
        } else {
          try {
            const res = await this._fetch(url, {
              method: 'POST',
              headers,
              body: JSON.stringify(body),
              signal: abortSignal,
            });

            if (!res.ok) {
              const reason = await res.text();
              const msg = `OpenAI error ${
                res.status || res.statusText
              }: ${reason}`;
              const error = new ChatGPTError(msg, {cause: res});
              error.statusCode = res.status;
              error.statusText = res.statusText;
              return reject(error);
            }

            const response: openai.CreateChatCompletionResponse =
              await res.json();
            if (this._debug) {
              console.log(response);
            }

            if (response?.id) {
              result.id = response.id;
            }

            if (response?.choices?.length > 0 && response.choices[0].message) {
              const message = response.choices[0].message;
              result.text = message.content;
              if (message.role) {
                result.role = message.role;
              }
            } else {
              const res = response as any;
              return reject(
                new Error(
                  `OpenAI error: ${
                    res?.detail?.message || res?.detail || 'unknown'
                  }`
                )
              );
            }

            result.detail = response;

            return resolve(result);
          } catch (err) {
            return reject(err);
          }
        }
      }
    ).then((message) => {
      return this._upsertMessage(message).then(() => message);
    });

    if (timeoutMs) {
      if (abortController) {
        // This will be called when a timeout occurs in order for us to forcibly
        // ensure that the underlying HTTP request is aborted.
        (responseP as any).cancel = () => {
          abortController && abortController.abort();
        };
      }

      return pTimeout(responseP, {
        milliseconds: timeoutMs,
        message: 'OpenAI timed out waiting for response',
      });
    } else {
      return responseP;
    }
  };

  return RRR as ChatGPTAPI & PatchedChatGPTAPI;
};

export async function* streamAsyncIterable<T>(stream: ReadableStream<T>) {
  const reader = stream.getReader();
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) {
        return;
      }
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

async function fetchSSE(
  url: string,
  options: Parameters<typeof fetch>[1] & {onMessage: (data: string) => void},
  fetch2 = fetch
) {
  const {onMessage, ...fetchOptions} = options;
  const res: Response = await fetch(url, fetchOptions);
  if (!res.ok) {
    let reason: string;

    try {
      reason = await res.text();
    } catch (err) {
      reason = res.statusText;
    }

    const msg = `ChatGPT error ${res.status}: ${reason}`;
    const error = new ChatGPTError(msg, {cause: res});
    error.statusCode = res.status;
    error.statusText = res.statusText;
    throw error;
  }

  const parser = createParser((event) => {
    if (event.type === 'event') {
      onMessage(event.data);
    }
  });

  if (!res.body?.getReader) {
    // Vercel polyfills `fetch` with `node-fetch`, which doesn't conform to
    // web standards, so this is a workaround...
    const body: NodeJS.ReadableStream = res.body as any;

    if (!body.on || !body.read) {
      throw new ChatGPTError('unsupported "fetch" implementation');
    }

    body.on('readable', () => {
      let chunk: string | Buffer;
      while (null !== (chunk = body.read())) {
        parser.feed(chunk.toString());
      }
    });
  } else {
    for await (const chunk of streamAsyncIterable(res.body)) {
      const str = new TextDecoder().decode(chunk);
      parser.feed(str);
    }
  }
}
