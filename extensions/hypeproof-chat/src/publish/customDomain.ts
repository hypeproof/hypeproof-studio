// Custom domain for a Pages site: the records to give the participant, and the state machine
// that reads GitHub's view of the domain.
//
// We never touch DNS. The domain lives at the clinic's registrar; the honest limit of "one
// click" is: print the records → re-check on request → turn HTTPS on once GitHub's certificate
// exists (plan §4-1). The source for every value below is
// docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site.

import type { DnsRecord, DomainState } from "./publishContract.ts";
import { ghMessage, type GitHubApi } from "./githubApi.ts";

export const PAGES_A = ["185.199.108.153", "185.199.109.153", "185.199.110.153", "185.199.111.153"];
export const PAGES_AAAA = ["2606:50c0:8000::153", "2606:50c0:8001::153", "2606:50c0:8002::153", "2606:50c0:8003::153"];

/**
 * Two-label public suffixes that clinic domains actually use. A full Public Suffix List would
 * be a dependency for one decision (is `boadental.co.kr` an apex?); this short list covers the
 * Korean and common foreign second-level suffixes, and a miss only changes the `host` label we
 * print, which the registrar's own form makes obvious.
 */
const SECOND_LEVEL = new Set([
  "co.kr", "or.kr", "ne.kr", "re.kr", "pe.kr", "go.kr", "ac.kr", "hs.kr", "ms.kr", "es.kr", "sc.kr", "kg.kr", "mil.kr",
  "co.uk", "org.uk", "ac.uk", "co.jp", "or.jp", "ne.jp", "com.au", "net.au", "org.au", "com.cn", "com.tw", "com.sg",
]);

export function splitDomain(domain: string): { apex: string; sub: string } {
  const labels = domain.split(".");
  const lastTwo = labels.slice(-2).join(".");
  const apexLabels = SECOND_LEVEL.has(lastTwo) ? 3 : 2;
  return { apex: labels.slice(-apexLabels).join("."), sub: labels.slice(0, -apexLabels).join(".") };
}

/**
 * Records for `domain`, written as the registrar's form asks for them (`@` = the apex itself).
 * - apex (`boadental.co.kr`): four A + four AAAA at `@`, and `www` CNAME so the www form works.
 * - `www.<apex>`: `www` CNAME → `<login>.github.io`, plus the apex A/AAAA so the bare domain
 *   redirects to www instead of failing (GitHub's documented recommendation).
 * - any other subdomain: a single CNAME.
 * The CNAME value never contains the repository name — GitHub's docs call that out explicitly.
 */
export function dnsRecordsFor(domain: string, login: string): DnsRecord[] {
  const target = `${login.toLowerCase()}.github.io`;
  const { sub } = splitDomain(domain);
  const apexRecords: DnsRecord[] = [
    ...PAGES_A.map((value) => ({ type: "A" as const, host: "@", value })),
    ...PAGES_AAAA.map((value) => ({ type: "AAAA" as const, host: "@", value })),
  ];
  if (!sub) return [...apexRecords, { type: "CNAME", host: "www", value: target }];
  if (sub === "www") return [{ type: "CNAME", host: "www", value: target }, ...apexRecords];
  return [{ type: "CNAME", host: sub, value: target }];
}

export interface DomainCheck {
  state: DomainState;
  detail_ko: string;
}

interface PagesInfo {
  cname?: string | null;
  https_enforced?: boolean;
  https_certificate?: { state?: string } | null;
}

interface HealthDomain {
  dns_resolves?: boolean;
  is_valid?: boolean;
  is_pointed_to_github_pages_ip?: boolean;
  is_cname_to_github_user_domain?: boolean;
  is_https_eligible?: boolean;
}

/** Certificate states after which enforcing HTTPS is accepted (REST docs, `https_certificate.state`). */
const CERT_READY = new Set(["approved", "issued"]);

/**
 * Read the domain's state and advance it where GitHub allows:
 *   dns_pending   — health says the name does not resolve to Pages yet;
 *   cert_pending  — DNS is right, the Let's Encrypt certificate is not issued yet;
 *   https_enforced — HTTPS is (now) enforced.
 * `/pages/health` answers 202 while GitHub computes it ("first call 202, then 200"), so it is
 * polled a bounded number of times; an unanswered health check is reported as dns_pending,
 * never guessed as fine.
 */
export async function checkDomain(
  api: GitHubApi,
  repoPath: string,
  domain: string,
  deps: { sleep: (ms: number) => Promise<void> },
  opts: { healthTries: number; intervalMs: number },
): Promise<DomainCheck> {
  const pagesRes = await api.request("GET", `${repoPath}/pages`);
  const pages = (pagesRes.status === 200 ? pagesRes.json : null) as PagesInfo | null;
  if (pages?.https_enforced === true && (pages.cname ?? "").toLowerCase() === domain) {
    return { state: "https_enforced", detail_ko: `https://${domain}/ 연결과 보안(HTTPS)이 모두 끝났어요.` };
  }

  let health: HealthDomain | null = null;
  for (let i = 0; i < opts.healthTries; i++) {
    const h = await api.request("GET", `${repoPath}/pages/health`);
    if (h.status === 200) {
      health = ((h.json as { domain?: HealthDomain } | null)?.domain ?? null) as HealthDomain | null;
      break;
    }
    if (h.status !== 202) break;
    if (i < opts.healthTries - 1) await deps.sleep(opts.intervalMs);
  }
  const pointed = health
    ? health.dns_resolves === true &&
      (health.is_pointed_to_github_pages_ip === true || health.is_cname_to_github_user_domain === true || health.is_valid === true)
    : false;
  if (!pointed) {
    return { state: "dns_pending", detail_ko: "도메인 업체의 DNS에 아직 반영되지 않았어요(몇 분에서 길면 하루 걸려요)." };
  }

  const certState = pages?.https_certificate?.state ?? "";
  if (!CERT_READY.has(certState)) {
    return { state: "cert_pending", detail_ko: "도메인은 연결됐고 보안 인증서(HTTPS)를 발급받는 중이에요." };
  }
  const put = await api.request("PUT", `${repoPath}/pages`, { https_enforced: true });
  if (put.status >= 200 && put.status < 300) {
    return { state: "https_enforced", detail_ko: `https://${domain}/ 연결과 보안(HTTPS)이 모두 끝났어요.` };
  }
  // GitHub refuses enforcement until the certificate is fully provisioned even when the state
  // already reads "approved" for a short window; that is the same state to the participant.
  return { state: "cert_pending", detail_ko: `보안 인증서(HTTPS)를 마무리하는 중이에요. (${ghMessage(put) || put.status})` };
}
