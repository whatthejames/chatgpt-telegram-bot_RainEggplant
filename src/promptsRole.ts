import {Buffer} from 'buffer';
import Keyv from 'keyv';
import moment from 'moment';
import fs from 'fs';
import {promisify} from 'util';

export interface RoleInfo {
  role: string;
  shortName: string;
  prompt: string | undefined;
  userName?: string;
}

export let roles: RoleInfo[] = [
  {
    role: 'default',
    shortName: 'default',
    prompt: undefined,
  },
  {
    role: 'custom',
    shortName: 'custom',
    prompt: undefined,
  },
];

export const rolesMap = new Map<string, RoleInfo>();

let nowRole_: RoleInfo;

const init = (roles_: RoleInfo[], nowRoleShortName?: string) => {
  roles = roles_;
  roles_.forEach((T) => rolesMap.set(T.shortName, T));
  const n = rolesMap.get(nowRoleShortName || 'default');
  if (n) {
    nowRole_ = n;
  } else {
    nowRole_ = roles_[0];
  }
};
init(roles);

export const getNowRole = () => {
  return nowRole_;
};
export const getRolePrompt = (r: RoleInfo) => {
  if (!r.prompt) {
    return undefined;
  }
  return Buffer.from(r.prompt, 'base64').toString('utf-8');
};
export const setNowRole = (r: RoleInfo) => {
  nowRole_ = r;
};
export const setCustom = async (prompt: string, storage: Keyv) => {
  const n = rolesMap.get('custom');
  if (n) {
    n.prompt = Buffer.from(prompt).toString('base64');
    await saveCustomFrom(storage);
    {
      const nn = structuredClone(n);
      nn.prompt = prompt;
      await storage.set(
        `CustomRole:History-${moment().format('YYYYMMDD_HHmmSS')}`,
        nn
      );
    }
  }
};
export const loadCustomFromStorage = async (storage: Keyv) => {
  const r = await storage.get('CustomRole:Now');
  if (r) {
    try {
      const c = r as RoleInfo;
      if (c.role && c.shortName && c.shortName === 'custom') {
        const n = rolesMap.get('custom');
        if (n) {
          n.prompt = c.prompt;
          n.userName = c.userName;
          n.shortName = c.shortName;
          n.role = c.role;
        }
      }
    } catch (e) {
      console.error(e);
    }
  }
};
export const saveCustomFrom = async (storage: Keyv) => {
  const n = rolesMap.get('custom');
  if (n) {
    await storage.set('CustomRole:Now', n);
  }
};
export const saveCustomPoint = async (storage: Keyv) => {
  const n = rolesMap.get('custom');
  if (n) {
    const p = moment().format('YYYYMMDD_HHmmSS');
    await storage.set(`CustomRole:SavePoint:${p}`, n);
    return p;
  }
  return undefined;
};
export const loadCustomPoint = async (storage: Keyv, p: string) => {
  const r = await storage.get(`CustomRole:SavePoint:${p}`);
  if (r) {
    try {
      const c = r as RoleInfo;
      if (c.role && c.shortName && c.shortName === 'custom') {
        const n = rolesMap.get('custom');
        if (n) {
          n.prompt = c.prompt;
          n.userName = c.userName;
          n.shortName = c.shortName;
          n.role = c.role;
        }
      }
    } catch (e) {
      console.error(e);
    }
  }
};

export const loadFromJsonFile = async () => {
  const s = await promisify(fs.readFile)('prompts.json', 'utf-8');
  try {
    const j: RoleInfo[] = JSON.parse(s);
    console.log(j);
    if (
      j.every((T) => {
        return T.role.length > 0 && T.shortName.length > 0;
      })
    ) {
      init(j, nowRole_.shortName);
      console.log('loadFromJsonFile ok');
    }
  } catch (e) {
    console.error(e);
  }
};
