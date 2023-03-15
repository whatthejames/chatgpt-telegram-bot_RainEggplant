import _ from 'lodash';
import express from 'express';
import json5 from 'json5';
import Router from 'express-promise-router';

import Keyv, {Store} from 'keyv';
import {ChatGPT} from '../api';
import {ChatMessage} from 'chatgpt';

export class ServerApp {
  app = express();
  router = Router();

  async getMessageList(savePoint: string) {
    const oldPoint = await this.chatGPT.getContext();
    try {
      if (await this.chatGPT.resetContext(savePoint)) {
        const mm = await this.chatGPT.exportMessageList();
        if (mm && mm.length > 0) {
          await this.chatGPT.resetContext(oldPoint);
          return mm;
        }
      }
    } catch (e: any) {
      console.error(e);
      await this.chatGPT.resetContext(oldPoint);
      return e.message;
    }
    await this.chatGPT.resetContext(oldPoint);
    return undefined;
  }

  format = (m: ChatMessage[]) => {
    return m
      .map((T) => {
        return `${T.id} : ${T.role} \n${T.text}`;
      })
      .join('\n\n\n\n\n\n');
  };

  constructor(
    protected keyv: Keyv,
    protected chatGPT: ChatGPT,
    protected host = '0.0.0.0',
    protected port = 3033
  ) {
    this.app.use(this.router);

    this.router.get('/', async (req, res) => {
      res.send('Test');
    });
    this.router.get(/^\/html\/resetContext_/, async (req, res) => {
      const savePoint = req.path.replace(/^\/html\/resetContext_/, '');
      const m = await this.getMessageList(savePoint);
      if (_.isArray(m)) {
        return res.send(`<pre>${this.format(m)}\n</pre>`);
      }
      return res.send(m);
    });
    this.router.get(/^\/resetContext_/, async (req, res) => {
      const savePoint = req.path.replace(/^\/resetContext_/, '');
      const m = await this.getMessageList(savePoint);
      if (_.isArray(m)) {
        return res.send(this.format(m));
      }
      return res.send(m);
    });
    this.router.get(/^\/json\/resetContext_/, async (req, res) => {
      const savePoint = req.path.replace(/^\/json\/resetContext_/, '');
      const m = await this.getMessageList(savePoint);
      if (_.isArray(m)) {
        return res.json(m);
      }
      return res.send(m);
    });
    this.router.get('/searchText', async (req, res) => {
      const s = req.param('s');
      if (!s) {
        return res.send('undefined');
      }
      const result: {id: string; text: string}[] = [];
      for await (const d of this.keyv.iterator()) {
        if (d && d.text && _.isString(d.text) && d.id && _.isString(d.id)) {
          if ((d.text as string).search(s) !== -1) {
            result.push({
              id: d.id,
              text: d.text,
            });
          }
        }
      }
      return res.send(json5.stringify(result, undefined, 2));
    });

    this.app.listen(port, host);
  }
}
