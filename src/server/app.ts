import express from 'express';
import Router from 'express-promise-router';

import Keyv, {Store} from 'keyv';
import {ChatGPT} from '../api';
import {ChatMessage} from 'chatgpt';

export class ServerApp {
  app = express();
  router = Router();

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
    this.router.get(/^\/resetContext_/, async (req, res) => {
      const savePoint = req.path.replace(/^\/resetContext_/, '');
      const oldPoint = await chatGPT.getContext();
      try {
        const format = (m: ChatMessage[]) => {
          return m
            .map((T) => {
              return `${T.id} : ${T.role} \n${T.name}`;
            })
            .join('\n\n\n');
        };
        if (await chatGPT.resetContext(savePoint)) {
          const mm = await chatGPT.exportMessageList();
          if (mm && mm.length > 0) {
            const out = format(mm);
            res.send(out);
          }
        }
      } catch (e: any) {
        console.error(e);
        res.send(e.message);
      } finally {
        await chatGPT.resetContext(oldPoint);
      }
      res.send('undefined');
    });

    this.app.listen(port, host);
  }
}
