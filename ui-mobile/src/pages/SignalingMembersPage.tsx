import { Link } from 'react-router';
import { Button } from '../components/ui';
import { useSignalingClient } from '../context/signaling';

export function SignalingMembersPage() {
  const client = useSignalingClient();

  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">信令服务器的成员</h1>
        <Link className="inline-flex min-h-12 items-center text-sm font-medium text-sky-700 transition active:text-sky-800" to="/rtc">
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
        <div className="grid gap-2">
          {!client.assignedUserId && client.onlineMembers.length === 0 ? (
            <p className="rounded-xl bg-slate-50 px-3 py-4 text-sm text-slate-400">未连接信令服务器</p>
          ) : null}
          {client.assignedUserId ? <MemberCard id={client.assignedUserId} status={getSelfStatus(client.rtcState, client.rtcPeerId)} self /> : null}
          {client.onlineMembers.map((member) => {
            const status = getMemberRtcStatus(member, client.assignedUserId, client.memberRtcPeers);
            return <MemberCard id={member} status={status.label} busy={status.busy} key={member} />;
          })}
        </div>
      </section>
    </div>
  );
}

function MemberCard({ id, status, self, busy }: { id: string; status: string; self?: boolean; busy?: boolean }) {
  return (
    <article className="grid gap-1 rounded-xl bg-slate-50 px-3 py-3 text-sm">
      <span className="break-all font-mono font-medium text-slate-800">{id}</span>
      <span className={self ? 'text-emerald-700' : busy ? 'text-amber-700' : 'text-slate-600'}>{status}</span>
    </article>
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
