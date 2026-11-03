// DES-KNOW-33: measure the information icon beside the existing visible-text/contrast probe.
export const recipientMemoryProbe = selector => `(() => [...document.querySelectorAll(${JSON.stringify(selector)})].map(e => {
  const issues = [], marker = e.querySelector('[data-recipient-ai-memory-icon]');
  const svg = marker?.matches('svg') ? marker : marker?.querySelector('svg');
  if(e.dataset.memoryPolicy !== 'unknown') issues.push('unknown policy state missing');
  if(!svg) return [...issues,'information icon missing'];
  const r=svg.getBoundingClientRect(),s=getComputedStyle(svg),line=getComputedStyle(e);
  if(r.width<16 || r.height<16 || s.visibility!=='visible' || !svg.checkVisibility({opacityProperty:true,visibilityProperty:true})) issues.push('icon invisible or too small');
  if(s.stroke!==line.color) issues.push('icon must use the neutral text colour');
  if(Number.parseFloat(line.columnGap)<8) issues.push('icon/text gap below 8px');
  if(marker.getAttribute('aria-hidden')!=='true' || svg.getAttribute('focusable')!=='false') issues.push('decorative icon must not duplicate spoken copy or focus');
  if(!svg.querySelector('circle') || !svg.querySelector('path[d="M12 11v6M12 7.5v.01"]')) issues.push('information shape missing');
  return issues;
}))()`;
