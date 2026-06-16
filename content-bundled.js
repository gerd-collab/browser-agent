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
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('No canvas context');
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('img load failed')); img.src = `data:image/png;base64,${base64Image}`; });
      canvas.width = img.width; canvas.height = img.height; ctx.drawImage(img, 0, 0);
      const sx = canvas.width / innerWidth, sy = canvas.height / innerHeight;
      elements.forEach((el, i) => {
        try {
          const r = el.getBoundingClientRect(); const x = (r.left + r.width/2)*sx, y = (r.top + r.height/2)*sy, rad = Math.max(16, Math.min(r.width, r.height)*0.5*sx);
          ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI*2); ctx.fillStyle = 'rgba(255,0,0,0.9)'; ctx.fill();
          ctx.font = `bold ${rad}px Arial`; ctx.fillStyle = 'white'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText((i+1).toString(), x, y + rad*0.1);
        } catch {}
      });
      return canvas.toDataURL('image/png').split(',')[1];
    } catch (e) { throw e; }
  }
  remove() {}
}

class ActionExecutor {
  constructor() { this.cache = new Map(); }
  async execute(a) {
    try {
      switch (a.type) {
        case 'CLICK': return this.click(a.params?.elementId);
        case 'TYPE': return this.type(a.params?.elementId, a.params?.text);
        case 'SCROLL': return this.scroll(a.params?.direction, a.params?.amount);
        case 'WAIT': return this.wait(a.params?.ms || 1000);
        default: throw new Error('Unknown action: ' + a.type);
      }
    } catch (e) { throw e; }
  }
  getEl(id) { return this.find()[id - 1]; }
  find() {
    try { return Array.from(document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [onclick], [tabindex]:not([tabindex="-1"])')).filter(e => this.vis(e) && this.vp(e)); } catch { return []; }
  }
  vis(el) { try { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && el.offsetWidth > 0; } catch { return false; } }
  vp(el) { try { const r = el.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; } catch { return false; } }
  click(id) {
    const el = this.getEl(id); if (!el) throw new Error('Element #' + id + ' not found');
    ['mousedown','mouseup','click'].forEach(t => el.dispatchEvent(new MouseEvent(t, {bubbles:true, cancelable:true, view:window})));
    if (el.tagName === 'A' && el.href) return { navigated: true, url: el.href };
    return { clicked: true, tag: el.tagName, text: el.innerText?.slice(0,50) };
  }
  type(id, text) {
    const el = this.getEl(id); if (!el) throw new Error('Element #' + id + ' not found');
    const ok = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable; if (!ok) throw new Error('Not typeable');
    el.focus(); if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') { el.value = text; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); } else { el.textContent = text; el.dispatchEvent(new Event('input',{bubbles:true})); }
    return { typed: true, text };
  }
  scroll(dir, amt = 500) { const d = dir === 'down' ? amt : -amt; window.scrollBy({top:d, behavior:'smooth'}); return { scrolled: dir, amount: d }; }
  wait(ms) { return new Promise(r => setTimeout(r, ms)); }
}

const annotator = new DOMAnnotator();
const executor = new ActionExecutor();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'PING': sendResponse({ pong: true }); return true;
    case 'ANNOTATE_DOM': handleAnnotate(msg.image(msg.image).then(sendResponse).catch(e => { console.error('[MiniMax] Annotate err', e); sendResponse({ error: e.message }); }); return true;
    case 'EXECUTE_ACTION': handleExec(msg.action).then(sendResponse).catch(e => { console.error('[MiniMax] Exec err', e); sendResponse({ success: false, error: e.message }); }); return true;
    case 'REMOVE_ANNOTATIONS': annotator.remove(); sendResponse({ success: true }); return true;
  }
});

async function handleAnnot(b64) {
  try {
    const els = annotator.findInteractiveElements(); console.log('[MiniMax] Found', els.length, 'elements');
    let img; try { img = await annotator.annotateScreenshot(b64, els); } catch { img = b64; }
    const map = {}; els.forEach((el, i) => { map[i+1] = { tag: el.tagName.toLowerCase(), type: el.type||'', text: el.innerText?.slice(0,100)||'', placeholder: el.placeholder||'', href: el.href||'', isVisible: annotator.isVisible(el), rect: el.getBoundingClientRect?.() ?? {top:0,left:0,width:0,height:0} }; });
    return { annotatedImage: img, elementMap: map };
  } catch (e) { throw e; }
}

async function handleExec(a) { try { return { success: true, result: await executor.execute(a) }; } catch (e) { return { success: false, error: e.message }; } }

console.log('[MiniMax Agent] Bundled content script loaded');