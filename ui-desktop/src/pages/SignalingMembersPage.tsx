import { Link } from 'react-router';
import { Button } from '../components/ui';
import { useSignalingClient } from '../context/signaling';

export function SignalingMembersPage() {
  const client = useSignalingClient();

  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">信令服务器的成员</h1>
        <Link className="text-sm font-medium text-sky-700 transition hover:text-sky-800" to="/rtc">
          返回 RTC
        </Link>
      </header>

      <section className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">服务器状态</h2>
          <Button onClick={client.refreshMembers}>刷新</Button>
        </div>
        <div className="grid gap-2 text-sm">
          <StatusLine label="信令服务地址" value={client.endpoint || '-'} mono />
          <StatusLine label="我的成员 ID" value={client.assignedUserId || '-'} mono />
        </div>
        {client.error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">错误: {client.error}</p> : null}
      </section>

      <section className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold">服务器上的成员</h2>
        <div className="overflow-auto">
          <table className="w-full min-w-105 border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="px-3 py-2 font-medium">成员 ID</th>
                <th className="px-3 py-2 font-medium">状态</th>
              </tr>
            </thead>
            <tbody>
              {!client.assignedUserId && client.onlineMembers.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-slate-400" colSpan={2}>
                    未连接信令服务器
                  </td>
                </tr>
              ) : null}
              {client.assignedUserId ? (
                <tr className="border-b border-slate-100">
                  <td className="px-3 py-2 font-mono text-slate-800">{client.assignedUserId}</td>
                  <td className="px-3 py-2 text-emerald-700">{getSelfStatus(client.rtcState, client.rtcPeerId)}</td>
                </tr>
              ) : null}
              {client.onlineMembers.map((member) => {
                const status = getMemberRtcStatus(member, client.assignedUserId, client.memberRtcPeers);
                return (
                  <tr className="border-b border-slate-100 last:border-0" key={member}>
                    <td className="px-3 py-2 font-mono text-slate-800">{member}</td>
                    <td className={status.busy ? 'px-3 py-2 text-amber-700' : 'px-3 py-2 text-slate-600'}>{status.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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

function getSelfStatus(rtcState: string, rtcPeerId: string) {
  if (rtcState === 'connected' && rtcPeerId) {
    return `我 / RTC 已连接 ${rtcPeerId}`;
  }
  return '我';
}

function getMemberRtcStatus(member: string, selfUserId: string, memberRtcPeers: Record<string, string>) {
  const peerId = memberRtcPeers[member];
  if (!peerId) {
    return { label: '在线 / 空闲', busy: false };
  }
  if (peerId === selfUserId) {
    return { label: '在线 / 已连接我', busy: false };
  }
  return { label: `在线 / 已连接 ${peerId}`, busy: true };
}
