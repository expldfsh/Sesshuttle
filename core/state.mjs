import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { id } from './util.mjs';
export class State {
  constructor(root) {
    fs.mkdirSync(root,{recursive:true,mode:0o700}); this.root=root;
    this.db=new DatabaseSync(path.join(root,'sesshuttle.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
    this.getStatement=this.db.prepare('SELECT value FROM kv WHERE key=?');
    this.putStatement=this.db.prepare('INSERT INTO kv VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    if(!this.get('device')) this.set('device',{id:id(),name:'My computer'});
  }
  get(k,fallback=null) {const row=this.getStatement.get(k); return row?JSON.parse(row.value):fallback;}
  set(k,v) {this.putStatement.run(k,JSON.stringify(v));return v;}
  keys(prefix) {return this.db.prepare('SELECT key FROM kv WHERE key LIKE ? ORDER BY key').all(prefix+'%').map(x=>x.key);}
  close(){this.db.close();}
}
