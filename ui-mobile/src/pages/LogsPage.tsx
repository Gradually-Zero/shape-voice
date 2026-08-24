import { Link } from 'react-router';
import { Button } from '../components/ui';
import { useSignalingClient } from '../context/signaling';

export function LogsPage() {
  const client = useSignalingClient();

  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">调试日志</h1>
        <Link className="inline-flex min-h-12 items-center text-sm font-medium text-sky-700 transition active:text-sky-800" to="/rtc">
          返回 RTC
        </Link>
      </header>

      <section className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">调试日志</h2>
          <Button onClick={client.clearLogs} disabled={client.logs.length === 0}>
            清空
          </Button>
        </div>
        <div className="grid max-h-96 gap-2 overflow-auto">
          {client.logs.length === 0 ? <p className="text-sm text-slate-400">暂无消息</p> : null}
          {client.logs.map((log) => (
            <article className="grid gap-1 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-800" key={log.id}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-600">{log.direction}</span>
                <span className="text-slate-400">{log.timestamp}</span>
              </div>
              <pre className="overflow-auto whitespace-pre-wrap wrap-break-word">{formatPayload(log.payload)}</pre>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function formatPayload(payload: unknown) {
  if (typeof payload === 'string') {
    return payload;
  }
  return JSON.stringify(payload, null, 2);
}
