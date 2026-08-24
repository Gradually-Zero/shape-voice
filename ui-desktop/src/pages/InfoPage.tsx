import { Link } from 'react-router';
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useState } from 'react';
import { getConfigFilePath } from '../commands/settings';
import type { ReactNode } from 'react';

type LocalIpInfo = {
  ips: string[];
};

type InfoRow = {
  key: string;
  zhName: string;
  enName: string;
  supported: boolean;
  value: string;
};

type InfoTab = 'config' | 'device' | 'paths' | 'app' | 'os';

const tabs: Array<{ key: InfoTab; label: string }> = [
  { key: 'config', label: '应用配置信息' },
  { key: 'device', label: '设备信息' },
  { key: 'paths', label: '路径目录' },
  { key: 'app', label: '应用信息' },
  { key: 'os', label: '系统信息' },
];

const pathDefinitions: Array<{ key: string; zhName: string }> = [
  { key: 'appCacheDir', zhName: '应用缓存目录' },
  { key: 'appConfigDir', zhName: '应用配置目录' },
  { key: 'appDataDir', zhName: '应用数据目录' },
  { key: 'appLocalDataDir', zhName: '应用本地数据目录' },
  { key: 'appLogDir', zhName: '应用日志目录' },
  { key: 'audioDir', zhName: '音频目录' },
  { key: 'cacheDir', zhName: '缓存目录' },
  { key: 'configDir', zhName: '配置目录' },
  { key: 'dataDir', zhName: '数据目录' },
  { key: 'desktopDir', zhName: '桌面目录' },
  { key: 'documentDir', zhName: '文档目录' },
  { key: 'downloadDir', zhName: '下载目录' },
  { key: 'executableDir', zhName: '可执行文件目录' },
  { key: 'fontDir', zhName: '字体目录' },
  { key: 'homeDir', zhName: '用户主目录' },
  { key: 'localDataDir', zhName: '本地数据目录' },
  { key: 'pictureDir', zhName: '图片目录' },
  { key: 'publicDir', zhName: '公共目录' },
  { key: 'resourceDir', zhName: '应用资源目录' },
  { key: 'runtimeDir', zhName: '运行时目录' },
  { key: 'tempDir', zhName: '临时目录' },
  { key: 'templateDir', zhName: '模板目录' },
  { key: 'videoDir', zhName: '视频目录' },
];

const appDefinitions: Array<{ key: string; zhName: string }> = [
  { key: 'getName', zhName: '应用名称' },
  { key: 'getVersion', zhName: '应用版本' },
  { key: 'getTauriVersion', zhName: 'Tauri 版本' },
  { key: 'getIdentifier', zhName: '应用标识符' },
  { key: 'getBundleType', zhName: '打包类型' },
  { key: 'fetchDataStoreIdentifiers', zhName: '数据存储标识列表' },
];

const osDefinitions: Array<{ key: string; zhName: string }> = [
  { key: 'arch', zhName: '系统架构' },
  { key: 'eol', zhName: '换行标记' },
  { key: 'exeExtension', zhName: '可执行文件扩展名' },
  { key: 'family', zhName: '系统家族' },
  { key: 'hostname', zhName: '主机名' },
  { key: 'locale', zhName: '系统语言区域' },
  { key: 'platform', zhName: '系统平台' },
  { key: 'type', zhName: '操作系统类型' },
  { key: 'version', zhName: '操作系统版本' },
];

export function InfoPage() {
  const [activeTab, setActiveTab] = useState<InfoTab>('config');
  const [localIps, setLocalIps] = useState<string[]>([]);
  const [configFilePath, setConfigFilePath] = useState<string | null>(null);
  const [webviewVersion, setWebviewVersion] = useState('读取中...');
  const [pathRows, setPathRows] = useState<InfoRow[]>(buildLoadingRows(pathDefinitions));
  const [appRows, setAppRows] = useState<InfoRow[]>(buildLoadingRows(appDefinitions));
  const [osRows, setOsRows] = useState<InfoRow[]>(buildLoadingRows(osDefinitions));

  const { localIpv4, localIpv6 } = useMemo(() => {
    const ipv4 = localIps.filter((ip) => ip.includes('.'));
    const ipv6 = localIps.filter((ip) => ip.includes(':'));
    return { localIpv4: ipv4, localIpv6: ipv6 };
  }, [localIps]);

  useEffect(() => {
    let active = true;

    Promise.allSettled([invoke<LocalIpInfo>('network_get_local_ips'), getConfigFilePath()]).then((results) => {
      if (!active) {
        return;
      }

      const [ipResult, configPathResult] = results;
      setLocalIps(ipResult.status === 'fulfilled' ? ipResult.value.ips : []);
      setConfigFilePath(configPathResult.status === 'fulfilled' ? configPathResult.value.path : null);
    });

    invoke<string>('get_webview_version')
      .then((version) => {
        if (active) {
          setWebviewVersion(version);
        }
      })
      .catch((error) => {
        if (active) {
          setWebviewVersion(`获取失败：${toErrorMessage(error)}`);
        }
      });

    invoke<InfoRow[]>('get_all_paths')
      .then((rows) => {
        if (active) {
          setPathRows(rows);
        }
      })
      .catch((error) => {
        if (active) {
          setPathRows(buildErrorRows(pathDefinitions, error));
        }
      });

    invoke<InfoRow[]>('get_all_app_info')
      .then((rows) => {
        if (active) {
          setAppRows(rows);
        }
      })
      .catch((error) => {
        if (active) {
          setAppRows(buildErrorRows(appDefinitions, error));
        }
      });

    invoke<InfoRow[]>('get_all_os_info')
      .then((rows) => {
        if (active) {
          setOsRows(rows);
        }
      })
      .catch((error) => {
        if (active) {
          setOsRows(buildErrorRows(osDefinitions, error));
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">更多信息</h1>
        <Link className="text-sm font-medium text-sky-700 transition hover:text-sky-800" to="/settings">
          返回设置
        </Link>
      </header>

      <section className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                activeTab === tab.key ? 'bg-sky-100 text-sky-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'config' ? (
          <InfoSection title="应用配置信息">
            <StatusLine label="配置文件路径" value={configFilePath || '-'} mono />
          </InfoSection>
        ) : null}

        {activeTab === 'device' ? (
          <InfoSection title="设备信息">
            <StatusLine label="本机 IPv4" value={localIpv4.length > 0 ? localIpv4.join(' / ') : '暂无'} mono />
            <StatusLine label="本机 IPv6" value={localIpv6.length > 0 ? localIpv6.join(' / ') : '暂无'} mono />
            <StatusLine label="WebView/WebKit 版本" value={webviewVersion} mono />
          </InfoSection>
        ) : null}

        {activeTab === 'paths' ? <InfoTable rows={pathRows} /> : null}
        {activeTab === 'app' ? <InfoTable rows={appRows} /> : null}
        {activeTab === 'os' ? <InfoTable rows={osRows} /> : null}
      </section>
    </div>
  );
}

function InfoSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-3">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="grid gap-2 text-sm">{children}</div>
    </div>
  );
}

function InfoTable({ rows }: { rows: InfoRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-240 w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
            <th className="w-52 px-3 py-2 font-medium">中文含义</th>
            <th className="w-56 px-3 py-2 font-medium">英文标识</th>
            <th className="w-40 px-3 py-2 font-medium">当前平台是否支持</th>
            <th className="px-3 py-2 font-medium">获取到的值</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-slate-100 align-top last:border-0">
              <td className="px-3 py-2 text-slate-700">{row.zhName}</td>
              <td className="px-3 py-2 font-mono text-xs text-slate-700">{row.enName}</td>
              <td className="px-3 py-2">
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                    row.supported ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                  }`}
                >
                  {row.supported ? '支持' : '不支持'}
                </span>
              </td>
              <td className="break-all px-3 py-2 font-mono text-xs text-slate-700">{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusLine({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <p className="break-all">
      <span className="text-slate-500">{label}: </span>
      <span className={`${mono ? 'font-mono' : ''} text-slate-800`}>{value}</span>
    </p>
  );
}

function buildLoadingRows(definitions: Array<{ key: string; zhName: string }>): InfoRow[] {
  return definitions.map((item) => ({
    key: item.key,
    zhName: item.zhName,
    enName: item.key,
    supported: false,
    value: '加载中...',
  }));
}

function buildErrorRows(definitions: Array<{ key: string; zhName: string }>, error: unknown): InfoRow[] {
  return definitions.map((item) => ({
    key: item.key,
    zhName: item.zhName,
    enName: item.key,
    supported: false,
    value: `命令调用失败：${toErrorMessage(error)}`,
  }));
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
