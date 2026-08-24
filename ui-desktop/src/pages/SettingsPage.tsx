import { Link } from 'react-router';
import { useEffect, useMemo, useState } from 'react';
import { Button, TextInput } from '../components/ui';
import { getDefaultDownloadDir } from '../commands/transfer';
import { loadActive, pickDownloadDir, saveActive } from '../commands/settings';
import type { Settings } from '../commands/settings';

const defaultSettings: Settings = {
  lastConnectedSignalingServer: {
    host: '',
    port: '',
    protocol: 'ws',
    path: 'signaling',
  },
  transfer: {
    downloadDir: '',
  },
};

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [savedSettings, setSavedSettings] = useState<Settings>(defaultSettings);
  const [defaultDownloadDir, setDefaultDownloadDir] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const draftDownloadDir = settings.transfer.downloadDir;
  const savedDownloadDir = savedSettings.transfer.downloadDir;
  const savedDownloadDirTrimmed = savedDownloadDir.trim();
  const displayDownloadDir = savedDownloadDir.trim() || defaultDownloadDir;
  const savedMatchesDefaultDownloadDir = normalizePathForCompare(savedDownloadDir) === normalizePathForCompare(defaultDownloadDir);
  const savedHasCustomDownloadDir = savedDownloadDirTrimmed !== '' && !savedMatchesDefaultDownloadDir;
  const hasChanges = useMemo(() => draftDownloadDir !== savedDownloadDir, [draftDownloadDir, savedDownloadDir]);

  const onPickDir = async () => {
    setBusy(true);
    setError('');
    try {
      const picked = await pickDownloadDir();
      if (picked) {
        setSettings((prev) => ({
          ...prev,
          transfer: {
            ...prev.transfer,
            downloadDir: picked,
          },
        }));
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const onRestoreDefault = () => {
    setSettings((prev) => ({
      ...prev,
      transfer: {
        ...prev.transfer,
        downloadDir: '',
      },
    }));
  };

  const onSave = async () => {
    setBusy(true);
    setError('');
    const nextSettings: Settings = {
      ...settings,
      transfer: {
        ...settings.transfer,
        downloadDir: settings.transfer.downloadDir.trim(),
      },
    };
    try {
      await saveActive(nextSettings);
      setSettings(nextSettings);
      setSavedSettings(nextSettings);
      window.dispatchEvent(new CustomEvent('shape-voice-download-dir-changed'));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    let active = true;
    const bootstrap = async () => {
      setLoading(true);
      setError('');
      try {
        const [nextSettings, nextDefaultDownloadDir] = await Promise.all([loadActive(), getDefaultDownloadDir()]);
        if (!active) {
          return;
        }
        setSettings(nextSettings);
        setSavedSettings(nextSettings);
        setDefaultDownloadDir(nextDefaultDownloadDir);
      } catch (err) {
        if (!active) {
          return;
        }
        setError(String(err));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    bootstrap();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="grid gap-4">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold">设置</h1>
      </header>

      <section className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">展示区</h2>
          <div className="flex flex-wrap items-center gap-3">
            {loading ? <span className="text-sm text-slate-400">加载中</span> : null}
            <Link className="text-sm font-medium text-sky-700 transition hover:text-sky-800" to="/info">
              查看更多信息
            </Link>
          </div>
        </div>

        <div className="grid gap-2 text-sm">
          <p className="break-all">
            <span className="text-slate-500">下载目录: </span>
            <span className="font-mono text-slate-800">{displayDownloadDir || '-'}</span>
          </p>
        </div>
        {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">错误: {error}</p> : null}
      </section>

      <section className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold">配置区</h2>

        <div className="grid gap-2 md:grid-cols-[1fr_auto] md:items-end">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-slate-700">下载路径</span>
            <TextInput
              value={draftDownloadDir}
              placeholder={defaultDownloadDir || '使用默认下载目录'}
              disabled={loading || busy}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  transfer: {
                    ...prev.transfer,
                    downloadDir: event.target.value,
                  },
                }))
              }
            />
          </label>
          <Button onClick={() => onPickDir()} disabled={loading || busy}>
            选择目录
          </Button>
        </div>
      </section>

      <section className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold">操作区</h2>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {savedHasCustomDownloadDir ? (
            <Button onClick={onRestoreDefault} disabled={loading || busy}>
              恢复默认
            </Button>
          ) : (
            <span />
          )}
          <Button variant="primary" onClick={() => onSave()} disabled={loading || busy || !hasChanges}>
            保存配置
          </Button>
        </div>
      </section>
    </div>
  );
}

function normalizePathForCompare(path: string) {
  return path.trim().replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase();
}
