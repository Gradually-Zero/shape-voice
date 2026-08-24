import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Button, Select, TextInput } from '../components/ui';

type BindHost = '127.0.0.1' | '0.0.0.0';

type AppConfig = {
  host: BindHost;
  port: number;
};

type ServerStatus = {
  running: boolean;
  host: BindHost | null;
  port: number | null;
};

type LocalIpInfo = {
  ips: string[];
};

const DEFAULT_PORT = 18080;

const defaultConfig: AppConfig = {
  host: '0.0.0.0',
  port: DEFAULT_PORT,
};

export function SignalingPage() {
  const [config, setConfig] = useState<AppConfig>(defaultConfig);
  const [savedConfig, setSavedConfig] = useState<AppConfig>(defaultConfig);
  const [status, setStatus] = useState<ServerStatus>({ running: false, host: null, port: null });
  const [localIps, setLocalIps] = useState<string[]>([]);
  const [error, setError] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const statusLabel = useMemo(() => {
    if (!status.running) {
      return '已停止';
    }
    return '运行中';
  }, [status.running]);

  const displayPort = status.port ?? config.port;

  const connectAddresses = useMemo(() => {
    if (!status.running) {
      return [];
    }

    const activeHost = status.host ?? config.host;
    const activePort = status.port ?? config.port;
    const hosts = activeHost === '0.0.0.0' ? ['127.0.0.1', ...localIps.filter((ip) => ip.includes('.'))] : ['127.0.0.1'];
    return [...new Set(hosts)].map((host) => `ws://${host}:${activePort}/signaling`);
  }, [config.host, config.port, localIps, status.host, status.port, status.running]);

  const hasConfigChanges = useMemo(
    () => config.host !== savedConfig.host || Number(config.port) !== savedConfig.port,
    [config.host, config.port, savedConfig.host, savedConfig.port],
  );

  const refreshStatus = async () => {
    const nextStatus = await invoke<ServerStatus>('server_status');
    setStatus(nextStatus);
  };

  const onSaveConfig = async () => {
    setBusy(true);
    setError('');
    try {
      const payload = {
        host: config.host,
        port: Number(config.port),
      };
      const nextConfig = await invoke<AppConfig>('config_set', { payload });
      setConfig(nextConfig);
      setSavedConfig(nextConfig);
      await refreshStatus();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const onStart = async () => {
    setBusy(true);
    setError('');
    try {
      await invoke('server_start', { host: config.host, port: Number(config.port) });
      await refreshStatus();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const onStop = async () => {
    setBusy(true);
    setError('');
    try {
      await invoke('server_stop');
      await refreshStatus();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    let active = true;
    const bootstrap = async () => {
      try {
        const [nextConfig, nextStatus, localIpInfo] = await Promise.all([
          invoke<AppConfig>('config_get'),
          invoke<ServerStatus>('server_status'),
          invoke<LocalIpInfo>('network_get_local_ips'),
        ]);
        if (!active) {
          return;
        }
        setConfig(nextConfig);
        setSavedConfig(nextConfig);
        setStatus(nextStatus);
        setLocalIps(localIpInfo.ips);
      } catch (err) {
        if (!active) {
          return;
        }
        setError(String(err));
      }
    };
    bootstrap();

    const unlistenPromise = getCurrentWindow().onCloseRequested(async (event) => {
      const latestStatus = await invoke<ServerStatus>('server_status').catch((err) => {
        console.error('failed to read signaling server status before close', err);
        return null;
      });
      if (!latestStatus?.running) {
        return;
      }

      const shouldExit = window.confirm('信令服务仍在运行，确认退出并关闭服务吗？');
      if (!shouldExit) {
        event.preventDefault();
        return;
      }

      try {
        await invoke('server_stop');
      } catch (err) {
        console.error('failed to stop signaling server before close', err);
      }
    });

    return () => {
      active = false;
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  return (
    <div className="grid gap-4">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold">在此设备开启信令服务</h1>
      </header>

      <section className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold">展示区</h2>
        <div className="grid gap-2 text-sm">
          <p>
            <span className="text-slate-500">状态: </span>
            <span className={status.running ? 'font-medium text-emerald-700' : 'font-medium text-slate-700'}>{statusLabel}</span>
          </p>
          <p>
            <span className="text-slate-500">监听地址: </span>
            <span className="font-mono text-slate-800">{status.host ?? config.host}</span>
          </p>
          <p>
            <span className="text-slate-500">监听端口: </span>
            <span className="font-mono text-slate-800">{displayPort}</span>
          </p>
        </div>
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-500">可连接地址: </span>
            {connectAddresses.length === 0 ? <span className="text-sm text-slate-400">服务启动后显示</span> : null}
          </div>
          <div className="grid gap-2">
            {connectAddresses.length > 0
              ? connectAddresses.map((address) => (
                  <code className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-800" key={address}>
                    {address}
                  </code>
                ))
              : null}
          </div>
        </div>
        {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">错误: {error}</p> : null}
      </section>

      <section className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold">配置区</h2>
        <div className="grid max-w-sm gap-4">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-slate-700">监听地址</span>
            <Select
              value={config.host}
              disabled={busy || status.running}
              onChange={(event) =>
                setConfig((prev) => ({
                  ...prev,
                  host: event.target.value as BindHost,
                }))
              }
            >
              <option value="0.0.0.0">0.0.0.0（允许局域网访问）</option>
              <option value="127.0.0.1">127.0.0.1（仅本机）</option>
            </Select>
          </label>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-slate-700">端口</span>
            <TextInput
              type="number"
              min={1}
              max={65535}
              value={config.port}
              disabled={busy || status.running}
              onChange={(event) =>
                setConfig((prev) => ({
                  ...prev,
                  port: Number(event.target.value || DEFAULT_PORT),
                }))
              }
            />
          </label>
        </div>
      </section>

      <section className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold">操作区</h2>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            {hasConfigChanges ? (
              <Button onClick={onSaveConfig} disabled={busy}>
                保存配置
              </Button>
            ) : null}
          </div>
          <div>
            {status.running ? (
              <Button variant="danger" onClick={onStop} disabled={busy}>
                停止服务
              </Button>
            ) : (
              <Button variant="primary" onClick={onStart} disabled={busy}>
                启动服务
              </Button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
