import { Emitter } from './event';
import type { Disposable } from './event';
import type { RtcTextService } from './text-service';
import type { ReceivedFile, RtcBinaryEvent, RtcControlEvent, TransferProgress, TransferStorageAdapter, UploadReadyEvent } from './types';

const ID_SIZE = 12;
const SERIES_SIZE = 4;
const CHANNEL_MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
const CHANNEL_DRAIN_INTERVAL_MS = 4;
const APPEND_BATCH_BYTES = 1024 * 1024;

type TransferControl =
  | { type: 'FILE_START'; id: string; name: string; size: number; total: number }
  | { type: 'FILE_READY'; id: string }
  | { type: 'FILE_ABORT'; id: string; message: string }
  | { type: 'FILE_FINISH'; id: string };

interface ReceiveMeta {
  id: string;
  name: string;
  size: number;
  total: number;
  pendingChunks: Uint8Array[];
  pendingBytes: number;
  flushChain: Promise<void>;
  finishRequested: boolean;
  finishing: boolean;
}

interface OutgoingMeta {
  file: File;
  total: number;
  sending: boolean;
}

const getId = () =>
  Math.random()
    .toString(36)
    .slice(2, 2 + ID_SIZE)
    .padEnd(ID_SIZE, '0');

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  if (error && typeof error === 'object') {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
      return maybeMessage;
    }
  }
  return String(error);
};

const toControl = (payload: Record<string, unknown>): TransferControl | null => {
  const type = payload.type;
  if (type === 'FILE_START') {
    return {
      type,
      id: String(payload.id || ''),
      name: String(payload.name || ''),
      size: Number(payload.size || 0),
      total: Number(payload.total || 0),
    };
  }
  if (type === 'FILE_READY') {
    return {
      type,
      id: String(payload.id || ''),
    };
  }
  if (type === 'FILE_ABORT') {
    return {
      type,
      id: String(payload.id || ''),
      message: String(payload.message || ''),
    };
  }
  if (type === 'FILE_FINISH') {
    return {
      type,
      id: String(payload.id || ''),
    };
  }
  return null;
};

const encodeChunk = (id: string, index: number, payload: ArrayBuffer) => {
  const idBytes = new Uint8Array(ID_SIZE);
  for (let i = 0; i < ID_SIZE; i += 1) {
    idBytes[i] = id.charCodeAt(i) || 0;
  }

  const series = new Uint8Array(SERIES_SIZE);
  series[0] = (index >> 24) & 0xff;
  series[1] = (index >> 16) & 0xff;
  series[2] = (index >> 8) & 0xff;
  series[3] = index & 0xff;

  return new Blob([idBytes, series, payload]);
};

const decodeChunk = (buffer: ArrayBuffer) => {
  const idBytes = new Uint8Array(buffer.slice(0, ID_SIZE));
  const series = new Uint8Array(buffer.slice(ID_SIZE, ID_SIZE + SERIES_SIZE));
  const data = buffer.slice(ID_SIZE + SERIES_SIZE);
  const id = String.fromCharCode(...idBytes).replace(/\0/g, '');
  const index = (series[0] << 24) | (series[1] << 16) | (series[2] << 8) | series[3];
  return { id, index, data };
};

export class FileTransferService {
  private readonly outgoing = new Map<string, OutgoingMeta>();
  private readonly incomingMeta = new Map<string, ReceiveMeta>();
  private readonly rtc: RtcTextService;
  private readonly storage: TransferStorageAdapter;
  private readonly controlSubscription: Disposable;
  private readonly binarySubscription: Disposable;
  private readonly onDidChangeProgressEmitter = new Emitter<TransferProgress>();
  private readonly onDidStartUploadEmitter = new Emitter<UploadReadyEvent>();
  private readonly onDidReceiveFileEmitter = new Emitter<ReceivedFile>();
  private readonly onDidErrorEmitter = new Emitter<string>();

  public readonly onDidChangeProgress = this.onDidChangeProgressEmitter.event;
  public readonly onDidStartUpload = this.onDidStartUploadEmitter.event;
  public readonly onDidReceiveFile = this.onDidReceiveFileEmitter.event;
  public readonly onDidError = this.onDidErrorEmitter.event;

  constructor(rtc: RtcTextService, storage: TransferStorageAdapter) {
    this.rtc = rtc;
    this.storage = storage;
    this.controlSubscription = rtc.onDidReceiveControl((event) =>
      this.handleControl(event).catch((error) => {
        this.onDidErrorEmitter.fire(`handle control failed: ${getErrorMessage(error)}`);
      }),
    );
    this.binarySubscription = rtc.onDidReceiveBinary((event) => this.handleBinary(event));
  }

  public destroy() {
    this.controlSubscription.dispose();
    this.binarySubscription.dispose();
    const pending = [...this.incomingMeta.keys()];
    pending.forEach((id) => {
      this.storage.abortReceive(id).catch(() => undefined);
    });
    this.outgoing.clear();
    this.incomingMeta.clear();
    this.onDidChangeProgressEmitter.dispose();
    this.onDidStartUploadEmitter.dispose();
    this.onDidReceiveFileEmitter.dispose();
    this.onDidErrorEmitter.dispose();
  }

  public async sendFiles(files: FileList | File[]) {
    const list = Array.isArray(files) ? files : Array.from(files);
    if (!this.rtc.isConnected()) {
      throw new Error('RTC data channel not open');
    }
    const chunkSize = this.rtc.getMaxChunkSize();

    for (const file of list) {
      const id = getId();
      const total = Math.ceil(file.size / chunkSize);
      this.outgoing.set(id, { file, total, sending: false });
      this.rtc.sendControl({
        type: 'FILE_START',
        id,
        name: file.name,
        size: file.size,
        total,
      });
      this.onDidChangeProgressEmitter.fire({
        id,
        name: file.name,
        size: file.size,
        total,
        index: 0,
        progress: 0,
        direction: 'upload',
      });
    }
  }

  private async sendSingleChunk(id: string, index: number, meta: OutgoingMeta) {
    const chunkSize = this.rtc.getMaxChunkSize();
    const start = index * chunkSize;
    const end = Math.min(start + chunkSize, meta.file.size);
    const data = await meta.file.slice(start, end).arrayBuffer();
    const packet = encodeChunk(id, index, data);
    this.rtc.sendBinary(packet);
  }

  private async waitForBufferedDrain(id: string) {
    while (this.rtc.getBufferedAmount() > CHANNEL_MAX_BUFFERED_BYTES) {
      if (!this.outgoing.has(id)) {
        return false;
      }
      await sleep(CHANNEL_DRAIN_INTERVAL_MS);
    }
    return true;
  }

  private async streamOutgoing(id: string, meta: OutgoingMeta) {
    const total = meta.total;
    for (let index = 0; index < total; index += 1) {
      if (!this.outgoing.has(id)) {
        return;
      }
      const canSend = await this.waitForBufferedDrain(id);
      if (!canSend) {
        return;
      }
      await this.sendSingleChunk(id, index, meta);
      this.onDidChangeProgressEmitter.fire({
        id,
        name: meta.file.name,
        size: meta.file.size,
        total,
        index: index + 1,
        progress: Math.floor(((index + 1) / Math.max(total, 1)) * 100),
        direction: 'upload',
      });
    }
  }

  private async flushPendingChunks(id: string, force = false) {
    const meta = this.incomingMeta.get(id);
    if (!meta) {
      return;
    }
    if (!force && meta.pendingBytes < APPEND_BATCH_BYTES) {
      return;
    }
    if (meta.pendingChunks.length === 0) {
      return;
    }

    const chunks = meta.pendingChunks;
    meta.pendingChunks = [];
    meta.pendingBytes = 0;

    try {
      await this.storage.appendChunks(id, chunks);
    } catch (error) {
      const reason = getErrorMessage(error);
      this.onDidErrorEmitter.fire(`append chunk failed: ${reason}`);
      this.storage.abortReceive(id).catch(() => undefined);
      this.rtc.sendControl({
        type: 'FILE_ABORT',
        id,
        message: `append chunk failed: ${reason}`,
      });
      this.incomingMeta.delete(id);
      throw error;
    }
  }

  private enqueueFlush(id: string, force = false) {
    const meta = this.incomingMeta.get(id);
    if (!meta) {
      return Promise.resolve();
    }
    meta.flushChain = meta.flushChain.then(() => this.flushPendingChunks(id, force));
    return meta.flushChain;
  }

  private async maybeFinalizeReceive(id: string) {
    const meta = this.incomingMeta.get(id);
    if (!meta || !meta.finishRequested || meta.finishing) {
      return;
    }
    meta.finishing = true;

    try {
      await this.enqueueFlush(id, true);
      const finished = await this.storage.finishReceive(id);
      this.onDidReceiveFileEmitter.fire({ id, name: meta.name, size: meta.size, path: finished.path });
      this.rtc.sendControl({ type: 'FILE_FINISH', id });
    } catch (error) {
      const reason = getErrorMessage(error);
      this.onDidErrorEmitter.fire(`finish receive failed: ${reason}`);
      this.rtc.sendControl({
        type: 'FILE_ABORT',
        id,
        message: `finish receive failed: ${reason}`,
      });
    } finally {
      this.incomingMeta.delete(id);
    }
  }

  private async handleControl(event: RtcControlEvent) {
    const control = toControl(event.payload);
    if (!control) {
      return;
    }

    if (control.type === 'FILE_START') {
      try {
        await this.storage.prepareReceive(control.id, control.name, control.size);
        this.incomingMeta.set(control.id, {
          id: control.id,
          name: control.name,
          size: control.size,
          total: control.total,
          pendingChunks: [],
          pendingBytes: 0,
          flushChain: Promise.resolve(),
          finishRequested: false,
          finishing: false,
        });
      } catch (error) {
        const reason = getErrorMessage(error);
        this.onDidErrorEmitter.fire(`prepare receive failed: ${reason}`);
        this.rtc.sendControl({
          type: 'FILE_ABORT',
          id: control.id,
          message: `prepare receive failed: ${reason}`,
        });
        return;
      }

      this.onDidChangeProgressEmitter.fire({
        id: control.id,
        name: control.name,
        size: control.size,
        total: control.total,
        index: 0,
        progress: 0,
        direction: 'download',
      });

      if (control.total === 0) {
        try {
          const finished = await this.storage.finishReceive(control.id);
          this.onDidReceiveFileEmitter.fire({ id: control.id, name: control.name, size: control.size, path: finished.path });
          this.rtc.sendControl({ type: 'FILE_FINISH', id: control.id });
        } catch (error) {
          this.onDidErrorEmitter.fire(`finish receive failed: ${getErrorMessage(error)}`);
        }
        this.incomingMeta.delete(control.id);
        return;
      }

      this.rtc.sendControl({
        type: 'FILE_READY',
        id: control.id,
      });
      return;
    }

    if (control.type === 'FILE_READY') {
      const meta = this.outgoing.get(control.id);
      if (!meta || meta.sending) {
        return;
      }
      meta.sending = true;
      this.onDidStartUploadEmitter.fire({
        id: control.id,
        name: meta.file.name,
        size: meta.file.size,
      });
      this.streamOutgoing(control.id, meta).catch((error) => {
        this.onDidErrorEmitter.fire(`stream send failed: ${getErrorMessage(error)}`);
        this.outgoing.delete(control.id);
      });
      return;
    }

    if (control.type === 'FILE_ABORT') {
      const meta = this.outgoing.get(control.id);
      if (!meta) {
        return;
      }
      this.outgoing.delete(control.id);
      this.onDidErrorEmitter.fire(control.message || `peer aborted receiving file ${meta.file.name}`);
      return;
    }

    if (control.type === 'FILE_FINISH') {
      const meta = this.outgoing.get(control.id);
      if (meta) {
        this.onDidChangeProgressEmitter.fire({
          id: control.id,
          name: meta.file.name,
          size: meta.file.size,
          total: meta.total,
          index: meta.total,
          progress: 100,
          direction: 'upload',
        });
      }
      this.outgoing.delete(control.id);
    }
  }

  private handleBinary(event: RtcBinaryEvent) {
    const buffer = event.data;
    if (buffer.byteLength < ID_SIZE + SERIES_SIZE) {
      return;
    }
    const { id, index, data } = decodeChunk(buffer);
    const meta = this.incomingMeta.get(id);
    if (!meta) {
      return;
    }

    const chunk = new Uint8Array(data);
    meta.pendingChunks.push(chunk);
    meta.pendingBytes += chunk.byteLength;

    if (meta.pendingBytes >= APPEND_BATCH_BYTES) {
      this.enqueueFlush(id).catch(() => undefined);
    }

    const next = index + 1;
    const progress = Math.floor((next / Math.max(meta.total, 1)) * 100);
    this.onDidChangeProgressEmitter.fire({
      id,
      name: meta.name,
      size: meta.size,
      total: meta.total,
      index: next,
      progress,
      direction: 'download',
    });

    if (next >= meta.total) {
      meta.finishRequested = true;
      this.maybeFinalizeReceive(id).catch((error) => {
        this.onDidErrorEmitter.fire(`finalize receive failed: ${getErrorMessage(error)}`);
      });
    }
  }
}
