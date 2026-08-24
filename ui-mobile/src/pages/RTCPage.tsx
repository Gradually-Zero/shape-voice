import { Link } from 'react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSignalingClient } from '../context/signaling';
import { loadActive, saveActive } from '../commands/settings';
import { Button, Textarea, TextInput } from '../components/ui';
import type { Settings } from '../commands/settings';

export function RTCPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const client = useSignalingClient();
  const initialEndpointRef = useRef(client.endpoint);
  const { setEndpoint } = client;
  const isConnected = client.state === 'connected';
  const isRegistered = isConnected && Boolean(client.assignedUserId);
  const isEndpointLocked = client.state === 'connecting' || isConnected;
  const canUseRtc = isConnected && client.rtcState !== 'closed';
  const [signalingHost, setSignalingHost] = useState('');
  const [signalingPort, setSignalingPort] = useState('');
  const [signalingPath, setSignalingPath] = useState('');
  const [endpointConfigError, setEndpointConfigError] = useState('');

  const normalizedSignalingPath = useMemo(() => normalizeSignalingPath(signalingPath), [signalingPath]);
  const endpointPreview = useMemo(
    () => buildEndpointPreview(signalingHost, signalingPort, normalizedSignalingPath),
    [signalingHost, signalingPort, normalizedSignalingPath],
  );

  const onSendFiles = async (files: FileList | null) => {
    await client.sendFiles(files);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const onConnectSignalingServer = async () => {
    setEndpointConfigError('');
    try {
      const currentSettings = await loadActive();
      const nextSettings: Settings = {
        ...currentSettings,
        lastConnectedSignalingServer: {
          host: signalingHost.trim(),
          port: signalingPort.trim(),
          protocol: 'ws',
          path: normalizedSignalingPath,
        },
      };
      await saveActive(nextSettings);
      client.connect();
    } catch (err) {
      setEndpointConfigError(`保存上次连接配置失败: ${String(err)}`);
    }
  };

  useEffect(() => {
    let active = true;
    const bootstrap = async () => {
      try {
        const nextSettings = await loadActive();
        if (!active) {
          return;
        }
        const lastConnected = nextSettings.lastConnectedSignalingServer;
        setSignalingHost(lastConnected.host);
        setSignalingPort(lastConnected.port);
        setSignalingPath(lastConnected.path || 'signaling');
      } catch (err) {
        const parsed = parseEndpoint(initialEndpointRef.current);
        if (active && parsed) {
          setSignalingHost(parsed.host);
          setSignalingPort(parsed.port);
          setSignalingPath(parsed.path || 'signaling');
          return;
        }
        if (active) {
          setEndpointConfigError(`读取上次连接配置失败: ${String(err)}`);
        }
      }
    };

    bootstrap();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setEndpoint(buildEndpoint(signalingHost, signalingPort, normalizedSignalingPath));
  }, [setEndpoint, signalingHost, signalingPort, normalizedSignalingPath]);

  useEffect(() => {
    const input = fileInputRef.current;
    if (!input) {
      return;
    }
    const onCancel = () => client.cancelFileSelection();
    input.addEventListener('cancel', onCancel);
    return () => input.removeEventListener('cancel', onCancel);
  }, [client]);

  return (
    <div className="grid gap-4">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold">传输</h1>
      </header>

      <section className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">展示区</h2>
          <Link className="inline-flex min-h-12 items-center text-sm font-medium text-sky-700 transition active:text-sky-800" to="/logs">
            查看日志
          </Link>
        </div>
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <StatusLine label="信令服务地址" value={isRegistered ? client.endpoint || '-' : '-'} mono />
          <StatusLine label="连接状态" value={client.state} strong={isConnected} />
          <StatusLine label="我的成员 ID" value={client.assignedUserId || '-'} mono />
          <StatusLine label="在线成员数" value={isRegistered ? String(client.onlineMemberCount) : '-'} mono />
          <StatusLine label="RTC 状态" value={client.rtcState} />
          <StatusLine label="当前对端" value={client.rtcPeerId || '-'} mono />
        </div>
        {client.error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">错误: {client.error}</p> : null}
      </section>

      <section className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">连接信令服务器</h2>
          <Link className="inline-flex min-h-12 items-center text-sm font-medium text-sky-700 transition active:text-sky-800" to="/members">
            查看成员
          </Link>
        </div>
        <p className="break-all text-sm text-slate-600">
          <span className="text-slate-500">预览: </span>
          <span className="font-mono">{endpointPreview || '-'}</span>
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-slate-700">IP/主机</span>
            <TextInput value={signalingHost} onChange={(event) => setSignalingHost(event.target.value)} disabled={isEndpointLocked} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-slate-700">端口</span>
            <TextInput value={signalingPort} onChange={(event) => setSignalingPort(event.target.value)} disabled={isEndpointLocked} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-slate-700">协议</span>
            <TextInput value="ws" disabled />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-slate-700">路径</span>
            <TextInput value={signalingPath} onChange={(event) => setSignalingPath(event.target.value)} disabled={isEndpointLocked} />
          </label>
        </div>
        <div className="flex justify-end">
          {isConnected || client.state === 'connecting' ? (
            <Button onClick={client.disconnect}>断开</Button>
          ) : (
            <Button variant="primary" onClick={() => onConnectSignalingServer()}>
              连接信令服务器
            </Button>
          )}
        </div>
        {endpointConfigError ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">错误: {endpointConfigError}</p> : null}
      </section>

      <section className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold">在线成员</h2>
        <div className="flex flex-wrap gap-2">
          {client.onlineMembers.length === 0 ? <span className="text-sm text-slate-400">暂无在线成员</span> : null}
          {client.onlineMembers.map((member) => {
            const status = getMemberRtcStatus(member, client.assignedUserId, client.memberRtcPeers);
            const isCurrentPeer = client.rtcPeerId === member || status.connectedToMe;
            return (
              <div className="flex flex-wrap items-center gap-2 rounded-md bg-slate-100 px-2 py-2" key={member}>
                <div className="grid gap-0.5 text-left">
                  <span className="font-mono text-sm font-medium text-slate-800">{member}</span>
                  <span className={status.busy ? 'text-xs text-amber-700' : 'text-xs text-emerald-700'}>{status.label}</span>
                </div>
                {isCurrentPeer ? (
                  <Button onClick={client.closeRtc} disabled={client.rtcState === 'closed'}>
                    关闭 RTC
                  </Button>
                ) : (
                  <Button variant="primary" onClick={() => client.connectRtcTo(member)} disabled={!isConnected || status.busy}>
                    建立 RTC
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold">RTC 文本</h2>
        <Textarea value={client.rtcText} onChange={(event) => client.setRtcText(event.target.value)} disabled={!isConnected} />
        <div className="flex justify-end">
          <Button variant="primary" onClick={client.sendRtcText} disabled={!canUseRtc}>
            发送
          </Button>
        </div>
      </section>

      <section className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">消息列表 ({client.rtcMessages.length})</h2>
          <Button onClick={client.clearRtcMessages} disabled={client.rtcMessages.length === 0}>
            清空
          </Button>
        </div>
        <div className="grid max-h-96 gap-2 overflow-auto">
          {client.rtcMessages.length === 0 ? <p className="text-sm text-slate-400">暂无消息</p> : null}
          {client.rtcMessages.map((message) => (
            <article className="grid gap-1 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-800" key={message.id}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={message.outgoing ? 'font-semibold text-sky-700' : 'font-semibold text-slate-700'}>{message.from}</span>
                <span className="text-xs text-slate-400">[{message.time}]</span>
              </div>
              <p className="whitespace-pre-wrap wrap-break-word">{message.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold">文件传输</h2>
        <div className="flex flex-wrap justify-end gap-2">
          <input
            ref={fileInputRef}
            className="hidden"
            type="file"
            multiple
            onChange={(event) => {
              onSendFiles(event.target.files);
            }}
          />
          <Button
            variant="primary"
            onClick={() => {
              client.beginFileSelection();
              fileInputRef.current?.click();
            }}
            disabled={!canUseRtc || client.isRecoveringFileTransfer}
          >
            {client.isRecoveringFileTransfer ? '正在恢复连接…' : '选择并发送文件'}
          </Button>
        </div>
        {client.fileTransferRecoveryMessage ? (
          <p className="rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-700" aria-live="polite">
            {client.fileTransferRecoveryMessage}
          </p>
        ) : null}

        <div className="grid gap-2">
          <h3 className="text-sm font-semibold text-slate-700">传输进度</h3>
          {client.transferProgress.length === 0 ? <p className="text-sm text-slate-400">暂无传输</p> : null}
          {client.transferProgress.map((item) => (
            <article className="grid gap-2 rounded-md bg-slate-100 px-3 py-2 text-sm" key={`${item.direction}-${item.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-slate-800">{item.name}</span>
                <span className="text-slate-500">
                  {item.direction === 'upload' ? '上传' : '下载'} {item.progress}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-sky-600" style={{ width: `${Math.min(100, Math.max(0, item.progress))}%` }} />
              </div>
              <p className="text-xs text-slate-500">
                {formatBytes(item.size)} · {item.index}/{item.total}
              </p>
            </article>
          ))}
        </div>

        <div className="grid gap-2">
          <h3 className="text-sm font-semibold text-slate-700">已接收文件</h3>
          <p className="break-all text-sm text-slate-600">
            <span className="text-slate-500">保存目录: </span>
            <span className="font-mono">{client.downloadDir || '-'}</span>
          </p>
          {client.receivedFiles.length === 0 ? <p className="text-sm text-slate-400">暂无已接收文件</p> : null}
          {client.receivedFiles.map((file) => (
            <article className="grid gap-2 rounded-md bg-slate-100 px-3 py-2 text-sm" key={file.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-slate-800">{file.name}</span>
                <span className="text-slate-500">{formatBytes(file.size)}</span>
              </div>
              <p className="break-all font-mono text-xs text-slate-500">{file.path}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function StatusLine({ label, value, mono, strong }: { label: string; value: string; mono?: boolean; strong?: boolean }) {
  return (
    <p>
      <span className="text-slate-500">{label}: </span>
      <span className={`${mono ? 'font-mono' : ''} ${strong ? 'font-medium text-emerald-700' : 'text-slate-800'}`}>{value}</span>
    </p>
  );
}

function getMemberRtcStatus(member: string, selfUserId: string, memberRtcPeers: Record<string, string>) {
  const peerId = memberRtcPeers[member];
  if (!peerId) {
    return { label: '空闲', busy: false, connectedToMe: false };
  }
  if (peerId === selfUserId) {
    return { label: '已连接我', busy: false, connectedToMe: true };
  }
  return { label: `已连接: ${peerId}`, busy: true, connectedToMe: false };
}

function normalizeSignalingPath(path: string) {
  return path.trim().replace(/^\/+/, '');
}

function buildEndpoint(host: string, port: string, path: string) {
  const nextHost = host.trim();
  const nextPort = port.trim();
  if (!nextHost || !nextPort || !path) {
    return '';
  }
  return `ws://${nextHost}:${nextPort}/${path}`;
}

function buildEndpointPreview(host: string, port: string, path: string) {
  const nextHost = host.trim();
  const nextPort = port.trim();
  if (!nextHost && !nextPort && !path) {
    return '';
  }

  let preview = 'ws://';
  preview += nextHost;
  if (nextPort) {
    preview += `:${nextPort}`;
  }
  if (path) {
    preview += `/${path}`;
  }
  return preview;
}

function parseEndpoint(endpoint: string) {
  if (!endpoint.trim()) {
    return null;
  }
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'ws:') {
      return null;
    }
    return {
      host: url.hostname,
      port: url.port,
      path: normalizeSignalingPath(url.pathname),
    };
  } catch {
    return null;
  }
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}
