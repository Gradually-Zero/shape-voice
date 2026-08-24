import { Emitter } from './event';
import type { RtcBinaryEvent, RtcControlEvent, RtcState, RtcTextEvent, RtcTextMessage, RtcTextServiceOptions } from './types';

export class RtcTextService {
  private _peerId = '';
  private _state: RtcState = 'closed';
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private pendingIce: RTCIceCandidateInit[] = [];
  private makingOffer = false;
  private ignoreOffer = false;
  private isSettingRemoteAnswerPending = false;
  private readonly iceServers: RTCIceServer[];
  private readonly options: RtcTextServiceOptions;
  private readonly onDidChangeStateEmitter = new Emitter<RtcState>();
  private readonly onDidChangePeerEmitter = new Emitter<string>();
  private readonly onDidReceiveTextEmitter = new Emitter<RtcTextEvent>();
  private readonly onDidReceiveControlEmitter = new Emitter<RtcControlEvent>();
  private readonly onDidReceiveBinaryEmitter = new Emitter<RtcBinaryEvent>();
  private readonly onDidErrorEmitter = new Emitter<string>();
  private readonly onDidDebugEmitter = new Emitter<string>();

  public readonly onDidChangeState = this.onDidChangeStateEmitter.event;
  public readonly onDidChangePeer = this.onDidChangePeerEmitter.event;
  public readonly onDidReceiveText = this.onDidReceiveTextEmitter.event;
  public readonly onDidReceiveControl = this.onDidReceiveControlEmitter.event;
  public readonly onDidReceiveBinary = this.onDidReceiveBinaryEmitter.event;
  public readonly onDidError = this.onDidErrorEmitter.event;
  public readonly onDidDebug = this.onDidDebugEmitter.event;

  constructor(options: RtcTextServiceOptions) {
    this.options = options;
    this.iceServers = options.iceServers ?? [];
  }

  public get peerId() {
    return this._peerId;
  }

  public get state() {
    return this._state;
  }

  public async connect(peerId: string) {
    if (!peerId) {
      throw new Error('peerId required');
    }
    if (this._peerId && this._peerId !== peerId) {
      this.close();
    }

    this.setPeer(peerId);

    try {
      const pc = this.ensurePeerConnection(peerId, true);
      this.setState('connecting');
      this.makingOffer = true;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.options.signal.sendOffer(peerId, offer);
      this.debug(`offer sent to ${peerId}`);
    } catch (error) {
      this.onDidErrorEmitter.fire(`create/send offer failed: ${String(error)}`);
      throw error;
    } finally {
      this.makingOffer = false;
    }
  }

  public async handleOffer(fromUserId: string, sdp: RTCSessionDescriptionInit) {
    this.debug(`handleOffer from=${fromUserId} self=${this.options.selfUserId} state=${this.pc?.signalingState || 'none'}`);

    if (this._peerId && this._peerId !== fromUserId && this.pc) {
      const state = this.pc.connectionState;
      const reallyBusy = state === 'connected' || state === 'connecting';
      if (reallyBusy) {
        this.onDidErrorEmitter.fire(`Peer ${this.options.selfUserId} is busy`);
        return;
      }
      this.close();
    }

    try {
      this.setPeer(fromUserId);

      const pc = this.ensurePeerConnection(fromUserId, false);
      this.setState('connecting');
      const readyForOffer = !this.makingOffer && (pc.signalingState === 'stable' || this.isSettingRemoteAnswerPending);
      const offerCollision = !readyForOffer;
      const polite = this.isPolitePeer(fromUserId);

      this.ignoreOffer = !polite && offerCollision;
      if (this.ignoreOffer) {
        this.debug('offer ignored: glare and impolite side');
        return;
      }

      if (offerCollision && pc.signalingState !== 'stable') {
        await pc.setLocalDescription({ type: 'rollback' });
      }

      await pc.setRemoteDescription(sdp);
      await this.flushPendingIce(pc);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.options.signal.sendAnswer(fromUserId, answer);
      this.debug(`answer sent to ${fromUserId}`);
    } catch (error) {
      this.onDidErrorEmitter.fire(`handle offer failed: ${String(error)}`);
    }
  }

  public async handleAnswer(fromUserId: string, sdp: RTCSessionDescriptionInit) {
    this.debug(`handleAnswer from=${fromUserId} self=${this.options.selfUserId} hasPc=${Boolean(this.pc)}`);
    if (this._peerId && this._peerId !== fromUserId) {
      return;
    }
    if (!this.pc) {
      return;
    }

    try {
      this.isSettingRemoteAnswerPending = true;
      await this.pc.setRemoteDescription(sdp);
      await this.flushPendingIce(this.pc);
    } catch (error) {
      this.onDidErrorEmitter.fire(`handle answer failed: ${String(error)}`);
    } finally {
      this.isSettingRemoteAnswerPending = false;
    }
  }

  public async handleIce(fromUserId: string, candidate: RTCIceCandidateInit) {
    this.debug(`handleIce from=${fromUserId} self=${this.options.selfUserId} hasPc=${Boolean(this.pc)}`);
    if (this._peerId && this._peerId !== fromUserId) {
      return;
    }
    if (this.ignoreOffer) {
      return;
    }
    if (!this.pc || !this.pc.remoteDescription) {
      this.pendingIce.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(candidate);
    } catch (error) {
      this.onDidErrorEmitter.fire(`handle ice failed: ${String(error)}`);
    }
  }

  public sendText(text: string) {
    if (!text.trim()) {
      return;
    }
    const payload: RtcTextMessage = { type: 'TEXT', data: text };
    this.sendControl(payload as unknown as Record<string, unknown>);
  }

  public sendControl(payload: Record<string, unknown>) {
    if (!this.channel || this.channel.readyState !== 'open') {
      throw new Error('RTC data channel not open');
    }
    this.channel.send(JSON.stringify(payload));
  }

  public sendBinary(data: ArrayBuffer | Blob) {
    if (!this.channel || this.channel.readyState !== 'open') {
      throw new Error('RTC data channel not open');
    }
    if (data instanceof ArrayBuffer) {
      this.channel.send(new Uint8Array(data));
      return;
    }
    this.channel.send(data);
  }

  public isConnected() {
    return !!this.channel && this.channel.readyState === 'open';
  }

  public getBufferedAmount() {
    return this.channel?.bufferedAmount || 0;
  }

  public getMaxChunkSize() {
    let max = this.pc?.sctp?.maxMessageSize || 64 * 1024;
    max = Math.min(max, 256 * 1024);
    return Math.max(1024, max - 16);
  }

  public close() {
    this.closeConnection(true);
  }

  public destroy() {
    this.close();
    this.onDidChangeStateEmitter.dispose();
    this.onDidChangePeerEmitter.dispose();
    this.onDidReceiveTextEmitter.dispose();
    this.onDidReceiveControlEmitter.dispose();
    this.onDidReceiveBinaryEmitter.dispose();
    this.onDidErrorEmitter.dispose();
    this.onDidDebugEmitter.dispose();
  }

  private ensurePeerConnection(target: string, isInitiator: boolean) {
    if (this.pc && this.pc.connectionState !== 'closed') {
      return this.pc;
    }

    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
    });

    pc.onicecandidate = (event) => {
      if (!event.candidate || !this._peerId) {
        return;
      }
      this.options.signal.sendIce(this._peerId, event.candidate.toJSON());
    };

    pc.onconnectionstatechange = () => {
      this.setState(pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.onDidErrorEmitter.fire(`RTC state: ${pc.connectionState}`);
      }
    };

    pc.ondatachannel = (event) => {
      this.bindDataChannel(event.channel, target);
    };

    if (isInitiator) {
      const channel = pc.createDataChannel('tauri-transfer-main', {
        ordered: true,
      });
      this.bindDataChannel(channel, target);
    }

    this.pc = pc;
    return pc;
  }

  private bindDataChannel(channel: RTCDataChannel, target: string) {
    this.channel = channel;
    channel.onopen = () => this.setState(this.pc?.connectionState || 'connected');
    channel.onerror = () => this.onDidErrorEmitter.fire('RTC data channel error');
    channel.onclose = () => this.closeConnection(false);
    channel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const payload = JSON.parse(event.data) as Record<string, unknown>;
          if (payload.type === 'TEXT' && typeof payload.data === 'string') {
            this.onDidReceiveTextEmitter.fire({ text: payload.data, from: target });
          } else {
            this.onDidReceiveControlEmitter.fire({ payload, from: target });
          }
        } catch {
          // Ignore malformed payloads.
        }
        return;
      }

      if (event.data instanceof Blob) {
        event.data
          .arrayBuffer()
          .then((buffer) => this.onDidReceiveBinaryEmitter.fire({ data: buffer, from: target }))
          .catch((error) => this.onDidErrorEmitter.fire(`read RTC binary message failed: ${String(error)}`));
        return;
      }

      if (event.data instanceof ArrayBuffer) {
        this.onDidReceiveBinaryEmitter.fire({ data: event.data, from: target });
      }
    };
  }

  private async flushPendingIce(pc: RTCPeerConnection) {
    if (!this.pendingIce.length) {
      return;
    }
    for (const ice of this.pendingIce) {
      await pc.addIceCandidate(ice);
    }
    this.pendingIce = [];
  }

  private isPolitePeer(remotePeerId: string) {
    return this.options.selfUserId > remotePeerId;
  }

  private closeConnection(closeChannel: boolean) {
    const channel = this.channel;
    const pc = this.pc;
    const hadConnection = Boolean(channel || pc || this._peerId);

    this.channel = null;
    this.pc = null;

    if (channel) {
      channel.onclose = null;
    }
    if (pc) {
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.ondatachannel = null;
    }

    if (closeChannel && channel && channel.readyState !== 'closed') {
      channel.close();
    }
    if (pc && pc.connectionState !== 'closed') {
      pc.close();
    }

    this.pendingIce = [];
    this.setPeer('');
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.isSettingRemoteAnswerPending = false;

    if (hadConnection) {
      this.setState('closed');
    }
  }

  private debug(message: string) {
    this.onDidDebugEmitter.fire(message);
  }

  private setPeer(peerId: string) {
    if (this._peerId === peerId) {
      return;
    }
    this._peerId = peerId;
    this.onDidChangePeerEmitter.fire(peerId);
  }

  private setState(state: RtcState) {
    if (this._state === state) {
      return;
    }
    this._state = state;
    this.onDidChangeStateEmitter.fire(state);
  }
}
