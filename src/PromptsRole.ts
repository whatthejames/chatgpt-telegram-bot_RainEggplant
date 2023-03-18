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

export class RoleMode {
  protected roles: RoleInfo[] = [
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

  protected rolesMap = new Map<string, RoleInfo>();

  protected nowRole_!: RoleInfo;

  init = (roles_: RoleInfo[], nowRoleShortName?: string) => {
    this.roles = roles_;
    roles_.forEach((T) => this.rolesMap.set(T.shortName, T));
    const n = this.rolesMap.get(nowRoleShortName || 'default');
    if (n) {
      this.nowRole_ = n;
    } else {
      this.nowRole_ = roles_[0];
    }
  };

  constructor(protected storage: Keyv) {
    this.init(this.roles);
  }

  getRolesMap() {
    return this.rolesMap;
  }

  getRoles() {
    return this.roles;
  }

  getNowRole = () => {
    return this.nowRole_;
  };
  setNowRole = (r: RoleInfo) => {
    this.nowRole_ = r;
  };
  getRolePrompt = (r: RoleInfo) => {
    if (!r.prompt) {
      return undefined;
    }
    return Buffer.from(r.prompt, 'base64').toString('utf-8');
  };
  getNowRolePrompt = () => {
    const r: RoleInfo = this.getNowRole();
    if (!r.prompt) {
      return undefined;
    }
    return Buffer.from(r.prompt, 'base64').toString('utf-8');
  };
  setCustom = async (prompt: string) => {
    const n = this.rolesMap.get('custom');
    if (n) {
      n.prompt = Buffer.from(prompt).toString('base64');
      await this.saveCustomFrom();
      {
        const nn = structuredClone(n);
        nn.prompt = prompt;
        await this.storage.set(
          `CustomRole:History-${moment().format('YYYYMMDD_HHmmSS')}`,
          nn
        );
      }
    }
  };
  loadCustomFromStorage = async () => {
    const r = await this.storage.get('CustomRole:Now');
    if (r) {
      try {
        const c = r as RoleInfo;
        if (c.role && c.shortName && c.shortName === 'custom') {
          const n = this.rolesMap.get('custom');
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
  saveCustomFrom = async () => {
    const n = this.rolesMap.get('custom');
    if (n) {
      await this.storage.set('CustomRole:Now', n);
    }
  };
  saveCustomPoint = async () => {
    const n = this.rolesMap.get('custom');
    if (n) {
      const p = moment().format('YYYYMMDD_HHmmSS');
      await this.storage.set(`CustomRole:SavePoint:${p}`, n);
      return p;
    }
    return undefined;
  };
  loadCustomPoint = async (p: string) => {
    const r = await this.storage.get(`CustomRole:SavePoint:${p}`);
    if (r) {
      try {
        const c = r as RoleInfo;
        if (c.role && c.shortName && c.shortName === 'custom') {
          const n = this.rolesMap.get('custom');
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
  loadFromJsonFile = async () => {
    const s = await promisify(fs.readFile)('prompts.json', 'utf-8');
    try {
      const j: RoleInfo[] = JSON.parse(s);
      console.log(j);
      if (
        j.every((T) => {
          return T.role.length > 0 && T.shortName.length > 0;
        })
      ) {
        this.init(j, this.nowRole_.shortName);
        console.log('loadFromJsonFile ok');
      }
    } catch (e) {
      console.error(e);
    }
  };
}

let roleModeInstance: RoleMode | undefined = undefined;

export function initRoleMode(storage: Keyv) {
  if (!roleModeInstance) {
    roleModeInstance = new RoleMode(storage);
  }
  return roleModeInstance;
}

export function getRoleMode() {
  if (!roleModeInstance) {
    throw new Error('getRoleMode() Error (!roleModeInstance)');
  }
  return roleModeInstance;
}
