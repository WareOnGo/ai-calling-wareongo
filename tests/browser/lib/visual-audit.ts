import type { Page } from '@playwright/test';

// Check the rendered foreground against its actual layered background, including
// opacity. Token-only checks miss transparent buttons, tinted cells and hover states.
export async function unreadableText(page: Page) {
  return page.locator('.topnav a, .muted, .freshness, .grid-hint, .pill, .cell-status, .who-name, .btn, .btn-primary, .btn-row, .btn-export, .btn-assign, .field, .btn-done, td.cf-green, td.cf-red, td.cf-yel, .person-email, .filter-panel summary, .filter-panel label, .allocation-impact, .history-scope, .attempt-contact, .attempt-interval, .queue-overview p, .queue-disclosure > summary, .queue-disclosure > summary span, .queue-disclosure > p, .queue-contact small, .queue-contact-status, .queue-routing, .queue-counts dt, .wallet-compact, .wallet-compact .btn-text, .queue-repeat-confirm').evaluateAll(elements => {
    const rgba = (value: string) => {
      const numbers = value.match(/[\d.]+/g)?.map(Number) || [0, 0, 0, 0];
      return [numbers[0], numbers[1], numbers[2], numbers[3] ?? 1];
    };
    const over = (front: number[], back: number[]) => front.slice(0, 3).map((v, i) => v * front[3] + back[i] * (1 - front[3])).concat(1);
    const background = (element: Element | null): number[] => {
      if (!element) return [255, 255, 255, 1];
      const own = rgba(getComputedStyle(element).backgroundColor);
      return own[3] === 1 ? own : over(own, background(element.parentElement));
    };
    const luminance = (rgb: number[]) => rgb.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    return elements.flatMap(element => {
      const bounds = element.getBoundingClientRect(), style = getComputedStyle(element);
      if (!bounds.width || !bounds.height || bounds.right < 0 || bounds.left > innerWidth || bounds.bottom < 0 || bounds.top > innerHeight || element.matches(':disabled') || element.closest('[aria-disabled="true"], button:disabled') || style.visibility === 'hidden') return [];
      const text = (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement ? element.value : element.textContent || '').trim();
      if (!text) return [];
      let opacity = 1;
      for (let parent: Element | null = element; parent; parent = parent.parentElement) opacity *= Number(getComputedStyle(parent).opacity);
      const bg = background(element), fg = rgba(style.color); fg[3] *= opacity;
      const a = luminance(over(fg, bg)), b = luminance(bg), ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      return ratio >= 4.5 ? [] : [{ selector: element.className, text: text.slice(0, 65), contrast: Number(ratio.toFixed(2)) }];
    });
  });
}
