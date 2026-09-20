import {
  appendFileSync,
  chmodSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  type ReadStream,
} from 'node:fs';
import {createHash,timingSafeEqual} from 'node:crypto';
import {join} from 'node:path';

interface ArchiveMetadata {
  version:1;
  sessionId:string;
  tokenHash:string;
  createdAt:number;
  updatedAt:number;
  expiresAt:number;
  bytes:number;
  records:number;
  truncated:boolean;
}

export interface ArchiveStoreOptions {
  directory:string;
  retentionMs:number;
  sessionBytes:number;
  globalBytes:number;
}

export interface ArchiveDownload {
  stream:ReadStream;
  bytes:number;
  records:number;
  truncated:boolean;
  createdAt:number;
  updatedAt:number;
}

export interface ArchiveSource {
  path:string;
  truncated:boolean;
  release:()=>void;
}

export class ArchiveCapacityError extends Error {
  constructor() {
    super('Archive capacity reached');
    this.name='ArchiveCapacityError';
  }
}

const safeId=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const TRUNCATION_RESERVE=256;

export class ArchiveStore {
  private readonly metadata=new Map<string,ArchiveMetadata>();
  private readonly leases=new Map<string,number>();
  private totalBytes=0;

  constructor(private readonly options:ArchiveStoreOptions) {
    mkdirSync(options.directory,{recursive:true,mode:0o700});
    try { chmodSync(options.directory,0o700); } catch { /* Best effort on filesystems without POSIX modes. */ }
    this.load();
    this.cleanup();
  }

  private dataPath(id:string) { return join(this.options.directory,`${id}.ndjson`); }
  private metaPath(id:string) { return join(this.options.directory,`${id}.meta.json`); }
  private openArchiveCount() { return [...this.metadata.values()].filter(value=>!value.truncated).length; }

  private load() {
    for (const name of readdirSync(this.options.directory)) {
      if (!name.endsWith('.meta.json')) continue;
      try {
        const value=JSON.parse(readFileSync(join(this.options.directory,name),'utf8')) as ArchiveMetadata;
        if (value.version!==1||!safeId.test(value.sessionId)||!existsSync(this.dataPath(value.sessionId))) continue;
        try { chmodSync(this.dataPath(value.sessionId),0o600); chmodSync(join(this.options.directory,name),0o600); } catch { /* Best effort on non-POSIX filesystems. */ }
        const actual=statSync(this.dataPath(value.sessionId)).size;
        const metadata={...value,bytes:actual};
        this.metadata.set(value.sessionId,metadata);
        this.totalBytes+=actual;
      } catch { /* Ignore corrupt metadata without deleting potential evidence. */ }
    }
  }

  private persist(metadata:ArchiveMetadata) {
    const path=this.metaPath(metadata.sessionId);
    const temporary=`${path}.tmp`;
    writeFileSync(temporary,JSON.stringify(metadata),{encoding:'utf8',mode:0o600});
    renameSync(temporary,path);
  }

  private remove(id:string) {
    const metadata=this.metadata.get(id);
    if (!metadata) return;
    this.metadata.delete(id);
    this.totalBytes=Math.max(0,this.totalBytes-metadata.bytes);
    rmSync(this.dataPath(id),{force:true});
    rmSync(this.metaPath(id),{force:true});
    rmSync(`${this.metaPath(id)}.tmp`,{force:true});
  }

  cleanup(now=Date.now(),activeIds:ReadonlySet<string>=new Set()) {
    for (const [id,metadata] of this.metadata) {
      if (!activeIds.has(id)&&!this.leases.has(id)&&metadata.expiresAt<=now) this.remove(id);
    }
    if (this.totalBytes<=this.options.globalBytes) return;
    const inactive=[...this.metadata.values()].filter(value=>!activeIds.has(value.sessionId)&&!this.leases.has(value.sessionId)).sort((a,b)=>a.updatedAt-b.updatedAt);
    for (const metadata of inactive) {
      if (this.totalBytes<=this.options.globalBytes) break;
      this.remove(metadata.sessionId);
    }
  }

  begin(id:string,token:string,checkpoint:unknown) {
    if (!safeId.test(id)||this.metadata.has(id)) throw new Error('Invalid archive id');
    const now=Date.now();
    const line=`${JSON.stringify({kind:'checkpoint',sessionId:id,recordedAt:now,run:checkpoint})}\n`;
    const bytes=Buffer.byteLength(line);
    const reservedGlobal=TRUNCATION_RESERVE*(this.openArchiveCount()+1);
    if (bytes+TRUNCATION_RESERVE>this.options.sessionBytes||this.totalBytes+bytes+reservedGlobal>this.options.globalBytes) throw new ArchiveCapacityError();
    writeFileSync(this.dataPath(id),line,{encoding:'utf8',mode:0o600,flag:'wx'});
    const metadata:ArchiveMetadata={version:1,sessionId:id,tokenHash:hash(token),createdAt:now,updatedAt:now,expiresAt:now+this.options.retentionMs,bytes,records:1,truncated:false};
    this.metadata.set(id,metadata);
    this.totalBytes+=bytes;
    try { this.persist(metadata); }
    catch (error) { this.remove(id); throw error; }
  }

  markTruncated(id:string,reason:string) {
    const metadata=this.metadata.get(id);
    if (!metadata||metadata.truncated) return;
    const now=Date.now();
    const marker=`${JSON.stringify({kind:'archive-truncated',sessionId:id,recordedAt:now,reason})}\n`;
    const markerBytes=Buffer.byteLength(marker);
    try {
      appendFileSync(this.dataPath(id),marker);
      metadata.bytes+=markerBytes;
      metadata.records++;
      this.totalBytes+=markerBytes;
    } catch { /* The response header still reports truncation if the disk cannot accept a marker. */ }
    metadata.truncated=true;
    metadata.updatedAt=now;
    metadata.expiresAt=now+this.options.retentionMs;
    try { this.persist(metadata); } catch { /* Keep the in-memory status truthful for the running process. */ }
  }

  append(id:string,entry:unknown) {
    const metadata=this.metadata.get(id);
    if (!metadata||metadata.truncated) return;
    const now=Date.now();
    const line=`${JSON.stringify({sessionId:id,recordedAt:now,...(entry as object)})}\n`;
    const bytes=Buffer.byteLength(line);
    const reservedGlobal=TRUNCATION_RESERVE*this.openArchiveCount();
    if (metadata.bytes+bytes+TRUNCATION_RESERVE>this.options.sessionBytes||this.totalBytes+bytes+reservedGlobal>this.options.globalBytes) {
      this.markTruncated(id,'configured disk quota reached');
      return;
    }
    appendFileSync(this.dataPath(id),line);
    metadata.bytes+=bytes;
    metadata.records++;
    metadata.updatedAt=now;
    metadata.expiresAt=now+this.options.retentionMs;
    this.totalBytes+=bytes;
    this.persist(metadata);
  }

  private authorize(id:string,token:string) {
    const metadata=this.metadata.get(id);
    if (!metadata||!safeId.test(id)) return null;
    const supplied=Buffer.from(hash(token),'hex');
    const expected=Buffer.from(metadata.tokenHash,'hex');
    if (supplied.length!==expected.length||!timingSafeEqual(supplied,expected)) return null;
    return metadata;
  }

  private lease(id:string) {
    this.leases.set(id,(this.leases.get(id)??0)+1);
    let released=false;
    return ()=>{
      if (released) return;
      released=true;
      const remaining=(this.leases.get(id)??1)-1;
      if (remaining>0) this.leases.set(id,remaining); else this.leases.delete(id);
    };
  }

  source(id:string,token:string):ArchiveSource|null {
    const metadata=this.authorize(id,token);
    if (!metadata) return null;
    return {path:this.dataPath(id),truncated:metadata.truncated,release:this.lease(id)};
  }

  download(id:string,token:string):ArchiveDownload|null {
    const metadata=this.authorize(id,token);
    if (!metadata) return null;
    const release=this.lease(id);
    const stream=createReadStream(this.dataPath(id));
    stream.once('close',release);
    stream.once('error',release);
    return {
      stream,
      bytes:metadata.bytes,
      records:metadata.records,
      truncated:metadata.truncated,
      createdAt:metadata.createdAt,
      updatedAt:metadata.updatedAt,
    };
  }
}
