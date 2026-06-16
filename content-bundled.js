// Hand-maintained inlined bundle of content.js + utils/dom-annotator.js +
// utils/action-executor.js, flattened into one non-module script. Injected first by
// background.js (ES-module injection via executeScript is unreliable).
// KEEP IN SYNC with the source files by hand — there is no generator.

class DOMAnnotator {
  constructor() { this.annotationId = 0; }
  findInteractiveElements() {
    const selector = 'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [onclick], [tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll(selector))
      .filter(el => this.isVisible(el) && this.isInViewport(el))
      .slice(0, 50);
  }
  isVisible(el) {
    try { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' && el.offsetWidth > 0 && el.offsetHeight > 0; } catch { return false; }
  }
  isInViewport(el) {
    try { const r = el.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0 && r.left < innerWidth && r.right > 0; } catch { return false; }
  }
  async annotateScreenshot(base64Image, elements) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('No canvas context');
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('img load failed')); img.src = `data:image/png;base64,${base64Image}`; });
    canvas.width = img.width; canvas.height = img.height; ctx.drawImage(img, 0, 0);
    const sx = canvas.width / innerWidth, sy = canvas.height / innerHeight;
    elements.forEach((el, i) => {
      try {
        const r = el.getBoundingClientRect(); const x = (r.left + r.width / 2) * sx, y = (r.top + r.height / 2) * sy, rad = Math.max(16, Math.min(r.width, r.height) * 0.5 * sx);
        ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,0,0,0.9)'; ctx.fill();
        ctx.font = `bold ${rad}px Arial`; ctx.fillStyle = 'white'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText((i + 1).toString(), x, y + rad * 0.1);
      } catch {}
    });
    return canvas.toDataURL('image/png').split(',')[1];
  }
  async thumbnail(base64Png, maxW = 220) {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('thumb load failed')); img.src = `data:image/png;base64,${base64Png}`; });
    const scale = Math.min(1, maxW / (img.width || maxW));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.6);
  }
  remove() {}
}

class ActionExecutor {
  constructor() { this.cache = new Map(); }
  async execute(a) {
    switch (a.type) {
      case 'CLICK': return await this.click(a.params?.elementId);
      case 'TYPE': return await this.type(a.params?.elementId, a.params?.text);
      case 'SCROLL': return this.scroll(a.params?.direction, a.params?.amount);
      case 'WAIT': return this.wait(a.params?.ms || 1000);
      default: throw new Error('Unknown action: ' + a.type);
    }
  }
  getEl(id) { return this.find()[id - 1]; }
  // Must mirror DOMAnnotator.findInteractiveElements() exactly (selector + filters + cap).
  find() {
    try { return Array.from(document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [onclick], [tabindex]:not([tabindex="-1"])')).filter(e => this.vis(e) && this.vp(e)).slice(0, 50); } catch { return []; }
  }
  vis(el) { try { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' && el.offsetWidth > 0 && el.offsetHeight > 0; } catch { return false; } }
  vp(el) { try { const r = el.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0 && r.left < innerWidth && r.right > 0; } catch { return false; } }

  ensureCursor() {
    let c = document.getElementById('__mm_cursor');
    if (!c) {
      c = document.createElement('div');
      c.id = '__mm_cursor';
      c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,0.5))"><path d="M5 3l14 7-5.5 1.6L11 18z" fill="#111" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/></svg>';
      Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: '2147483647', width: '22px', height: '22px', pointerEvents: 'none', transition: 'transform 0.28s cubic-bezier(0.22,1,0.36,1)', transform: 'translate(-100px,-100px)' });
      (document.body || document.documentElement).appendChild(c);
    }
    return c;
  }
  async moveCursorTo(el) {
    try {
      const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
      this.ensureCursor().style.transform = `translate(${x}px, ${y}px)`;
      await this.delay(300); this.ripple(x, y); await this.delay(120);
    } catch {}
  }
  ripple(x, y) {
    try {
      const rp = document.createElement('div');
      Object.assign(rp.style, { position: 'fixed', left: (x - 16) + 'px', top: (y - 16) + 'px', width: '32px', height: '32px', border: '2px solid rgba(0,188,212,0.95)', borderRadius: '50%', zIndex: '2147483646', pointerEvents: 'none', transition: 'all 0.45s ease-out', opacity: '1', boxSizing: 'border-box' });
      (document.body || document.documentElement).appendChild(rp);
      requestAnimationFrame(() => { rp.style.transform = 'scale(2)'; rp.style.opacity = '0'; });
      setTimeout(() => rp.remove(), 480);
    } catch {}
  }
  delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  async click(id) {
    const el = this.getEl(id); if (!el) throw new Error('Element #' + id + ' not found');
    el.scrollIntoView({ block: 'center', inline: 'center' });
    await this.moveCursorTo(el);
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    if (typeof el.click === 'function') el.click(); else el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    if (el.tagName === 'A' && el.href) return { navigated: true, url: el.href };
    return { clicked: true, tag: el.tagName, text: el.innerText?.slice(0, 50) };
  }
  async type(id, text) {
    const el = this.getEl(id); if (!el) throw new Error('Element #' + id + ' not found');
    const ok = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable; if (!ok) throw new Error('Not typeable');
    el.scrollIntoView({ block: 'center', inline: 'center' });
    await this.moveCursorTo(el);
    el.focus(); if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') { el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } else { el.textContent = text; el.dispatchEvent(new Event('input', { bubbles: true })); }
    return { typed: true, text };
  }
  scroll(dir, amt = 500) { try { this.ensureCursor().style.transform = `translate(${innerWidth / 2}px, ${innerHeight / 2}px)`; } catch {} const d = dir === 'down' ? amt : -amt; window.scrollBy({ top: d, behavior: 'smooth' }); return { scrolled: dir, amount: d }; }
  wait(ms) { return new Promise(r => setTimeout(r, ms)); }
}

const annotator = new DOMAnnotator();
const executor = new ActionExecutor();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'PING': sendResponse({ pong: true }); return true;
    case 'ANNOTATE_DOM': handleAnnotate(msg.image).then(sendResponse).catch(e => { console.error('[MiniMax Agent] Annotate err', e); sendResponse({ error: e.message }); }); return true;
    case 'EXECUTE_ACTION': handleExecute(msg.action).then(sendResponse).catch(e => { console.error('[MiniMax Agent] Exec err', e); sendResponse({ success: false, error: e.message }); }); return true;
    case 'REMOVE_ANNOTATIONS': annotator.remove(); sendResponse({ success: true }); return true;
  }
});

async function handleAnnotate(b64) {
  const els = annotator.findInteractiveElements(); console.log('[MiniMax Agent] Found', els.length, 'elements');
  let img; try { img = await annotator.annotateScreenshot(b64, els); } catch (e) { console.warn('[MiniMax Agent] Screenshot annotation failed, using original:', e.message); img = b64; }
  const map = {}; els.forEach((el, i) => { map[i + 1] = { tag: el.tagName.toLowerCase(), type: el.type || '', text: el.innerText?.slice(0, 100) || '', placeholder: el.placeholder || '', href: el.href || '', isVisible: annotator.isVisible(el), rect: el.getBoundingClientRect?.() ?? { top: 0, left: 0, width: 0, height: 0 } }; });
  let thumb = null; try { thumb = await annotator.thumbnail(img); } catch (e) { console.warn('[MiniMax Agent] thumbnail failed:', e.message); }
  return { annotatedImage: img, elementMap: map, thumb };
}

async function handleExecute(a) { try { return { success: true, result: await executor.execute(a) }; } catch (e) { return { success: false, error: e.message }; } }

console.log('[MiniMax Agent] Bundled content script loaded');
