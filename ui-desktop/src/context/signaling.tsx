import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { RtcTextService } from 'rtc-browser/text';
import { FileTransferService } from 'rtc-browser/transfer';
import { loadActive } from '../commands/settings';
import { abortReceive, appendChunks, finishReceive, getDefaultDownloadDir, prepareReceive } from '../commands/transfer';
import type { ReceivedFile, RtcState, TransferProgress } from 'rtc-browser/types';

type ClientState = 'disconnected' | 'connecting' | 'connected' | 'error';
type LogDirection = 'incoming' | 'outgoing' | 'system';

interface MessageLog {
  id: number;
  direction: LogDirection;
  payload: unknown;
  timestamp: string;
}

interface RtcMessageItem {
  id: string;
  from: string;
  text: string;
  outgoing: boolean;
  time: string;
}

interface RtcSignalPayload {
  fromUserId?: unknown;
  payload?: unknown;
}

interface MemberStatePayload {
  userId?: unknown;
  rtcPeerId?: unknown;
}

interface SignalingClientContextValue {
  endpoint: string;
  setEndpoint: (value: string) => void;
  state: ClientState;
  assignedUserId: string;
  rtcText: string;
  setRtcText: (value: string) => void;
  rtcState: RtcState;
  rtcPeerId: string;
  transferProgress: TransferProgress[];
  receivedFiles: ReceivedFile[];
  downloadDir: string;
  onlineMembers: string[];
  onlineMemberCount: number;
  memberRtcPeers: Record<string, string>;
  rtcMessages: RtcMessageItem[];
  clearRtcMessages: () => void;
  logs: MessageLog[];
  clearLogs: () => void;
  error: string;
  connect: () => void;
  disconnect: () => void;
  connectRtcTo: (peerId: string) => void;
  closeRtc: () => void;
  sendRtcText: () => void;
  sendFiles: (files: FileList | null) => Promise<void>;
  refreshMembers: () => void;
}

const SignalingClientContext = createContext<SignalingClientContextValue | null>(null);

export function SignalingClientProvider({ children }: { children: React.ReactNode }) {
  const socketRef = useRef<WebSocket | null>(null);
  const rtcRef = useRef<RtcTextService | null>(null);
  const transferRef = useRef<FileTransferService | null>(null);
  const rtcPeerIdRef = useRef('');
  const rtcPresencePeerRef = useRef<string | null>(null);
  const [state, setState] = useState<ClientState>('disconnected');
  const [endpoint, setEndpoint] = useState('');
  const [assignedUserId, setAssignedUserId] = useState('');
  const [rtcText, setRtcText] = useState('');
  const [rtcState, setRtcState] = useState<RtcState>('closed');
  const [rtcPeerId, setRtcPeerId] = useState('');
  const [transferProgress, setTransferProgress] = useState<TransferProgress[]>([]);
  const [receivedFiles, setReceivedFiles] = useState<ReceivedFile[]>([]);
  const [downloadDir, setDownloadDir] = useState('');
  const [onlineMembers, setOnlineMembers] = useState<string[]>([]);
  const [memberRtcPeers, setMemberRtcPeers] = useState<Record<string, string>>({});
  const [rtcMessages, setRtcMessages] = useState<RtcMessageItem[]>([]);
  const [logs, setLogs] = useState<MessageLog[]>([]);
  const [error, setError] = useState('');
  const onlineMemberCount = assignedUserId ? onlineMembers.length + 1 : onlineMembers.length;

  const addLog = (direction: LogDirection, payload: unknown) => {
    setLogs((prev) =>
      [
        {
          id: Date.now() + Math.random(),
          direction,
          payload,
          timestamp: new Date().toLocaleTimeString(),
        },
        ...prev,
      ].slice(0, 50),
    );
  };

  const addRtcMessage = (message: Omit<RtcMessageItem, 'id' | 'time'>) => {
    setRtcMessages((prev) =>
      [
        {
          ...message,
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          time: new Date().toLocaleTimeString(),
        },
        ...prev,
      ].slice(0, 50),
    );
  };

  useEffect(() => {
    const refreshDownloadDir = async () => {
      const [settings, defaultDownloadDir] = await Promise.all([loadActive(), getDefaultDownloadDir()]);
      setDownloadDir(settings.transfer.downloadDir.trim() || defaultDownloadDir);
    };
    refreshDownloadDir().catch((err) => addLog('system', `获取默认保存目录失败: ${String(err)}`));

    window.addEventListener('shape-voice-download-dir-changed', refreshDownloadDir);

    return () => {
      window.removeEventListener('shape-voice-download-dir-changed', refreshDownloadDir);
      socketRef.current?.close();
      socketRef.current = null;
      transferRef.current?.destroy();
      transferRef.current = null;
      rtcRef.current?.destroy();
      rtcRef.current = null;
    };
  }, []);

  const sendJson = (payload: unknown, socket = socketRef.current) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket 未连接');
    }
    socket.send(JSON.stringify(payload));
    addLog('outgoing', payload);
  };

  const reportRtcPresence = (peerUserId: string | null, socket = socketRef.current) => {
    const nextPeerId = peerUserId || null;
    if (rtcPresencePeerRef.current === nextPeerId) {
      return;
    }
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      sendJson({ type: 'updateRtcPresence', peerUserId: nextPeerId }, socket);
      rtcPresencePeerRef.current = nextPeerId;
    } catch (err) {
      addLog('system', `RTC 占用状态上报失败: ${String(err)}`);
    }
  };

  const updateOnlineMembers = (payload: unknown) => {
    if (!isRecord(payload)) {
      return;
    }
    const messageType = typeof payload.type === 'string' ? payload.type : '';
    if (messageType === 'connectSignalingServerOk') {
      const selfId = typeof payload.userId === 'string' ? payload.userId : '';
      const members = Array.isArray(payload.members) ? payload.members.filter((member): member is string => typeof member === 'string') : [];
      const memberStates = Array.isArray(payload.memberStates) ? payload.memberStates : [];
      setAssignedUserId(selfId);
      setOnlineMembers([...new Set(members)].filter((member) => member !== selfId).sort());
      setMemberRtcPeers(parseMemberRtcPeers(memberStates, selfId));
      return;
    }

    if (messageType === 'memberJoined') {
      const nextUserId = typeof payload.userId === 'string' ? payload.userId : '';
      if (!nextUserId) {
        return;
      }
      setOnlineMembers((prev) => (prev.includes(nextUserId) ? prev : [...prev, nextUserId].sort()));
      setMemberRtcPeers((prev) => {
        const next = { ...prev };
        delete next[nextUserId];
        return next;
      });
      return;
    }

    if (messageType === 'memberLeft') {
      const nextUserId = typeof payload.userId === 'string' ? payload.userId : '';
      if (!nextUserId) {
        return;
      }
      setOnlineMembers((prev) => prev.filter((member) => member !== nextUserId));
      setMemberRtcPeers((prev) => {
        const next = { ...prev };
        delete next[nextUserId];
        for (const [member, peerId] of Object.entries(next)) {
          if (peerId === nextUserId) {
            delete next[member];
          }
        }
        return next;
      });
      if (rtcPeerIdRef.current === nextUserId) {
        closeRtc();
      }
      return;
    }

    if (messageType === 'memberPresenceChanged') {
      const nextUserId = typeof payload.userId === 'string' ? payload.userId : '';
      const nextRtcPeerId = typeof payload.rtcPeerId === 'string' ? payload.rtcPeerId : '';
      if (!nextUserId) {
        return;
      }
      setMemberRtcPeers((prev) => {
        const next = { ...prev };
        if (nextRtcPeerId) {
          next[nextUserId] = nextRtcPeerId;
        } else {
          delete next[nextUserId];
        }
        return next;
      });
    }
  };

  const destroyRtc = () => {
    transferRef.current?.destroy();
    transferRef.current = null;
    rtcRef.current?.destroy();
    rtcRef.current = null;
    setRtcState('closed');
    setRtcPeerId('');
    rtcPeerIdRef.current = '';
    rtcPresencePeerRef.current = null;
  };

  const updateTransferProgress = (event: TransferProgress) => {
    setTransferProgress((prev) => {
      const next = prev.filter((item) => item.id !== event.id);
      next.unshift(event);
      return next.slice(0, 20);
    });
  };

  const createTransferService = (rtc: RtcTextService) => {
    transferRef.current?.destroy();
    const transfer = new FileTransferService(rtc, {
      prepareReceive,
      appendChunks,
      finishReceive,
      abortReceive,
    });
    transfer.onDidChangeProgress((event) => {
      updateTransferProgress(event);
      if (event.progress === 100) {
        addLog('system', `文件${event.direction === 'upload' ? '上传' : '下载'}完成: ${event.name}`);
      }
    });
    transfer.onDidReceiveFile((file) => {
      setReceivedFiles((prev) => [file, ...prev.filter((item) => item.id !== file.id)].slice(0, 20));
      addLog('system', `文件已保存: ${file.path}`);
    });
    transfer.onDidError((message) => {
      setError(message);
      addLog('system', `文件传输错误: ${message}`);
    });
    transferRef.current = transfer;
    return transfer;
  };

  const clearRtcPeerState = () => {
    transferRef.current?.destroy();
    transferRef.current = null;
    rtcPeerIdRef.current = '';
    setRtcPeerId('');
  };

  const createRtcService = (selfUserId: string, socket: WebSocket) => {
    const rtc = new RtcTextService({
      selfUserId,
      signal: {
        sendOffer: (toUserId, sdp) => sendJson({ type: 'sendRtcOffer', toUserId, payload: { sdp } }, socket),
        sendAnswer: (toUserId, sdp) => sendJson({ type: 'sendRtcAnswer', toUserId, payload: { sdp } }, socket),
        sendIce: (toUserId, candidate) => sendJson({ type: 'sendRtcIce', toUserId, payload: { candidate } }, socket),
      },
    });
    rtc.onDidChangeState((nextState) => {
      setRtcState(nextState);
      if (nextState === 'connected' && rtcPeerIdRef.current) {
        reportRtcPresence(rtcPeerIdRef.current);
      }
      if (nextState === 'closed' || nextState === 'failed' || nextState === 'disconnected') {
        reportRtcPresence(null);
        clearRtcPeerState();
      }
      addLog('system', `RTC 状态: ${nextState}`);
    });
    rtc.onDidChangePeer((nextPeerId) => {
      rtcPeerIdRef.current = nextPeerId;
      setRtcPeerId(nextPeerId);
    });
    rtc.onDidReceiveText(({ text, from }) => {
      addRtcMessage({
        from,
        text,
        outgoing: false,
      });
      addLog('incoming', {
        type: 'rtcText',
        fromUserId: from,
        text,
      });
    });
    rtc.onDidError((message) => {
      setError(message);
      addLog('system', `RTC 错误: ${message}`);
    });
    rtc.onDidDebug((message) => {
      addLog('system', `RTC 调试: ${message}`);
    });
    createTransferService(rtc);
    return rtc;
  };

  const handleRtcSignal = (payload: unknown) => {
    if (!isRecord(payload)) {
      return;
    }
    const messageType = typeof payload.type === 'string' ? payload.type : '';
    if (messageType !== 'rtcOffer' && messageType !== 'rtcAnswer' && messageType !== 'rtcIce') {
      return;
    }

    const rtc = rtcRef.current;
    if (!rtc) {
      addLog('system', '收到 RTC 信令，但 RTC 服务未初始化');
      return;
    }
    if (!transferRef.current) {
      createTransferService(rtc);
    }

    const signalPayload = payload as RtcSignalPayload;
    const fromUserId = typeof signalPayload.fromUserId === 'string' ? signalPayload.fromUserId : '';
    const data = isRecord(signalPayload.payload) ? signalPayload.payload : {};
    if (!fromUserId) {
      return;
    }

    if (messageType === 'rtcOffer' && isSessionDescription(data.sdp)) {
      rtc.handleOffer(fromUserId, data.sdp);
      return;
    }

    if (messageType === 'rtcAnswer' && isSessionDescription(data.sdp)) {
      rtc.handleAnswer(fromUserId, data.sdp);
      return;
    }

    if (messageType === 'rtcIce' && isIceCandidate(data.candidate)) {
      rtc.handleIce(fromUserId, data.candidate);
    }
  };

  const connect = () => {
    const nextEndpoint = endpoint.trim();
    if (!nextEndpoint) {
      setError('Endpoint 不能为空');
      return;
    }

    socketRef.current?.close();
    destroyRtc();
    setMemberRtcPeers({});
    setError('');
    setAssignedUserId('');
    setOnlineMembers([]);
    setState('connecting');

    const socket = new WebSocket(nextEndpoint);
    socketRef.current = socket;

    socket.onopen = () => {
      if (socketRef.current !== socket) {
        return;
      }
      setState('connected');
      addLog('system', `已连接 ${nextEndpoint}`);
      sendJson({ type: 'connectSignalingServer' }, socket);
    };

    socket.onmessage = (event) => {
      if (socketRef.current !== socket) {
        return;
      }
      let payload: unknown = event.data;
      try {
        payload = JSON.parse(event.data as string) as unknown;
      } catch {
        addLog('system', '收到非 JSON 消息');
      }
      addLog('incoming', payload);
      updateOnlineMembers(payload);

      if (isRecord(payload) && payload.type === 'connectSignalingServerOk' && typeof payload.userId === 'string') {
        rtcRef.current = createRtcService(payload.userId, socket);
      }

      handleRtcSignal(payload);
    };

    socket.onerror = () => {
      if (socketRef.current !== socket) {
        return;
      }
      setState('error');
      setError('WebSocket 连接错误');
      addLog('system', 'WebSocket 连接错误');
    };

    socket.onclose = () => {
      if (socketRef.current !== socket) {
        return;
      }
      socketRef.current = null;
      destroyRtc();
      setState('disconnected');
      setAssignedUserId('');
      setOnlineMembers([]);
      setMemberRtcPeers({});
      addLog('system', '连接已关闭');
    };
  };

  const disconnect = () => {
    reportRtcPresence(null);
    socketRef.current?.close();
    socketRef.current = null;
    destroyRtc();
    setState('disconnected');
    setAssignedUserId('');
    setOnlineMembers([]);
    setMemberRtcPeers({});
    addLog('system', '已断开连接');
  };

  const connectRtcTo = (peerId: string) => {
    const rtc = rtcRef.current;
    if (!rtc) {
      setError('RTC 服务未初始化');
      return;
    }
    if (!transferRef.current) {
      createTransferService(rtc);
    }
    setError('');
    rtc.connect(peerId).catch((err) => {
      const message = String(err);
      setError(message);
      addLog('system', `RTC 连接失败: ${message}`);
    });
  };

  const closeRtc = () => {
    reportRtcPresence(null);
    transferRef.current?.destroy();
    transferRef.current = null;
    rtcRef.current?.close();
  };

  const sendRtcText = () => {
    setError('');
    try {
      const text = requireText(rtcText, '文本');
      const rtc = rtcRef.current;
      if (!rtc) {
        throw new Error('RTC 服务未初始化');
      }
      rtc.sendText(text);
      addRtcMessage({
        from: '我',
        text,
        outgoing: true,
      });
      addLog('outgoing', {
        type: 'rtcText',
        toUserId: rtcPeerId,
        text,
      });
      setRtcText('');
    } catch (err) {
      setError(String(err));
    }
  };

  const sendFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }
    setError('');
    try {
      const transfer = transferRef.current;
      if (!transfer) {
        throw new Error('文件传输服务未初始化');
      }
      await transfer.sendFiles(files);
      addLog('system', `已加入发送队列: ${files.length} 个文件`);
    } catch (err) {
      setError(String(err));
    }
  };

  const value = useMemo<SignalingClientContextValue>(
    () => ({
      endpoint,
      setEndpoint,
      state,
      assignedUserId,
      rtcText,
      setRtcText,
      rtcState,
      rtcPeerId,
      transferProgress,
      receivedFiles,
      downloadDir,
      onlineMembers,
      onlineMemberCount,
      memberRtcPeers,
      rtcMessages,
      clearRtcMessages: () => setRtcMessages([]),
      logs,
      clearLogs: () => setLogs([]),
      error,
      connect,
      disconnect,
      connectRtcTo,
      closeRtc,
      sendRtcText,
      sendFiles,
      refreshMembers: () => addLog('system', '已刷新当前缓存的信令成员'),
    }),
    [
      endpoint,
      state,
      assignedUserId,
      rtcText,
      rtcState,
      rtcPeerId,
      transferProgress,
      receivedFiles,
      downloadDir,
      onlineMembers,
      onlineMemberCount,
      memberRtcPeers,
      rtcMessages,
      logs,
      error,
    ],
  );

  return <SignalingClientContext.Provider value={value}>{children}</SignalingClientContext.Provider>;
}

export function useSignalingClient() {
  const context = useContext(SignalingClientContext);
  if (!context) {
    throw new Error('useSignalingClient must be used inside SignalingClientProvider');
  }
  return context;
}

function requireText(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} 不能为空`);
  }
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSessionDescription(value: unknown): value is RTCSessionDescriptionInit {
  if (!isRecord(value)) {
    return false;
  }
  return (value.type === 'offer' || value.type === 'answer') && typeof value.sdp === 'string';
}

function isIceCandidate(value: unknown): value is RTCIceCandidateInit {
  return isRecord(value) && typeof value.candidate === 'string';
}

function parseMemberRtcPeers(states: unknown[], selfId: string) {
  const next: Record<string, string> = {};
  for (const state of states) {
    if (!isRecord(state)) {
      continue;
    }
    const memberState = state as MemberStatePayload;
    const userId = typeof memberState.userId === 'string' ? memberState.userId : '';
    const rtcPeerId = typeof memberState.rtcPeerId === 'string' ? memberState.rtcPeerId : '';
    if (!userId || userId === selfId || !rtcPeerId) {
      continue;
    }
    next[userId] = rtcPeerId;
  }
  return next;
}
