// CGP-ART-R-011: aggregate by immutable version, never by the selected experiment.
import type { PublishExperimentView, PublishLinkView } from './publishView';

export function activePublishLink(link: PublishLinkView, now: number): boolean {
  if (link.state !== 'live' || !Number.isFinite(link.expires_at) || link.expires_at <= now || !link.share_url) return false;
  try {
    const url = new URL(link.share_url);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !/[\s\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(link.share_url);
  } catch { return false; }
}

export function publishSharing(versionId: string | null, experiments: PublishExperimentView[], now: number) {
  const links = [...new Map(experiments.filter(e => e.product_version_id === versionId).flatMap(e => e.links).map(l => [l.id, l])).values()];
  const active = links.filter(l => activePublishLink(l, now)).sort((a, b) => b.expires_at - a.expires_at);
  const until = active.length ? Math.max(...active.map(l => l.expires_at)) : null;
  const state = active.length ? 'live' : links.length ? 'closed' : 'unpublished';
  const label = state === 'live'
    ? `링크가 있는 누구나 · ${new Date(until!).toLocaleString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}까지`
    : state === 'closed' ? '링크 끊김' : '나만 볼 수 있어요';
  return { state, label, count: active.length, until, url: active[0]?.share_url ?? null,
    reason: state === 'unpublished' ? '먼저 이 버전을 공개해야 링크를 복사할 수 있어요.' : state === 'closed' ? '링크가 끊겨서 복사할 수 없어요.' : null };
}
