/**
 * Recognize only a complete request to open a general browser without a target.
 * This does not grant a tool capability or infer intent from a mixed authoring task.
 */
export function isGeneralBrowserOpenRequest(text: string): boolean {
  const request = text.trim().toLowerCase();
  const location = "(?:(?:오른쪽|우측|옆)(?:에|으로)?\\s*)?";
  const browser = "(?:(?:새|빈|일반|통합)\\s*)?(?:웹\\s*)?브라우저(?:\\s*창)?(?:을|를)?";
  const action = "(?:열어|띄워|켜|보여)(?:\\s*(?:줘(?:봐|바)?|주세요|줄래(?:요)?|주실래요|(?:줄|주실)\\s*수\\s*(?:있어(?:요)?|있나요|있을까요)))?";
  const korean = new RegExp(`^${location}${browser}\\s*(?:(?:좀|하나)\\s*)?${location}${action}\\s*${location}[.!?]*$`);
  const english = /^(?:please\s+)?(?:open|show|launch)\s+(?:(?:a|the|new|blank|empty|web|integrated)\s+)*browser(?:\s+(?:window|tab))?(?:\s+on\s+(?:the\s+)?right)?(?:\s+please)?[.!?]*$/;
  return korean.test(request) || english.test(request);
}
