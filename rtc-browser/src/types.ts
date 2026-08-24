export type RtcState = RTCPeerConnectionState | 'closed';

interface RtcSignalSender {
  sendOffer: (toUserId: string, sdp: RTCSessionDescriptionInit) => void;
  sendAnswer: (toUserId: string, sdp: RTCSessionDescriptionInit) => void;
  sendIce: (toUserId: string, candidate: RTCIceCandidateInit) => void;
}

export interface RtcTextServiceOptions {
  selfUserId: string;
  signal: RtcSignalSender;
  iceServers?: RTCIceServer[];
}

export interface RtcTextMessage {
  type: 'TEXT';
  data: string;
}

export interface RtcTextEvent {
  text: string;
  from: string;
}

export interface RtcControlEvent {
  payload: Record<string, unknown>;
  from: string;
}

export interface RtcBinaryEvent {
  data: ArrayBuffer;
  from: string;
}

export interface TransferStorageAdapter {
  prepareReceive: (fileId: string, name: string, size: number) => Promise<{ path: string }>;
  appendChunks: (fileId: string, chunks: Uint8Array[]) => Promise<{ written: number }>;
  finishReceive: (fileId: string) => Promise<{ path: string; written: number; expectedSize: number }>;
  abortReceive: (fileId: string) => Promise<void>;
}

type TransferDirection = 'upload' | 'download';

export interface TransferProgress {
  id: string;
  name: string;
  size: number;
  total: number;
  index: number;
  progress: number;
  direction: TransferDirection;
}

export interface ReceivedFile {
  id: string;
  name: string;
  size: number;
  path: string;
}

export interface UploadReadyEvent {
  id: string;
  name: string;
  size: number;
}
