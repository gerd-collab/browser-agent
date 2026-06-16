export class ActionExecutor {
  constructor() {
    this.elementCache = new Map();
  }

  async execute(action) {
    try {
      switch (action.type) {
        case 'CLICK':
          return await this.click(action.params?.elementId);
        case 'TYPE':
          return await this.type(action.params?.elementId, action.params?.text);
        case 'SCROLL':
          return this.scroll(action.params?.direction, action.params?.amount);
        case 'WAIT':
          return this.wait(action.params?.ms || 1000);
        default:
          throw new Error(`Unknown action type: ${action.type}`);
      }
    } catch (error) {
      console.error('[MiniMax Agent] Action execution failed:', error);
      throw error;
    }
  }

  // ---- Visible mouse cursor overlay ----
  ensureCursor() {
    let c = document.getElementById('__mm_cursor');
    if (!c) {
      c = document.createElement('div');
      c.id = '__mm_cursor';
      c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,0.5))"><path d="M5 3l14 7-5.5 1.6L11 18z" fill="#111" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/></svg>';
      Object.assign(c.style, {
        position: 'fixed', left: '0', top: '0', zIndex: '2147483647', width: '22px', height: '22px',
        pointerEvents: 'none', transition: 'transform 0.28s cubic-bezier(0.22,1,0.36,1)', transform: 'translate(-100px,-100px)'
      });
      (document.body || document.documentElement).appendChild(c);
    }
    return c;
  }

  async moveCursorTo(el) {
    try {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      this.ensureCursor().style.transform = `translate(${x}px, ${y}px)`;
      await this.delay(300);
      this.ripple(x, y);
      await this.delay(120);
    } catch {}
  }

  ripple(x, y) {
    try {
      const rp = document.createElement('div');
      Object.assign(rp.style, {
        position: 'fixed', left: (x - 16) + 'px', top: (y - 16) + 'px', width: '32px', height: '32px',
        border: '2px solid rgba(0,188,212,0.95)', borderRadius: '50%', zIndex: '2147483646',
        pointerEvents: 'none', transition: 'all 0.45s ease-out', opacity: '1', boxSizing: 'border-box'
      });
      (document.body || document.documentElement).appendChild(rp);
      requestAnimationFrame(() => { rp.style.transform = 'scale(2)'; rp.style.opacity = '0'; });
      setTimeout(() => rp.remove(), 480);
    } catch {}
  }

  delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  getElement(elementId) {
    const elements = this.findInteractiveElements();
    return elements[elementId - 1];
  }

  // Selector, filters and 50-element cap MUST stay identical to
  // DOMAnnotator.findInteractiveElements() — the model addresses elements by their
  // 1-based index in this list, so any divergence makes it act on the wrong element.
  findInteractiveElements() {
    try {
      const selector = 'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [onclick], [tabindex]:not([tabindex="-1"])';
      return Array.from(document.querySelectorAll(selector))
        .filter(el => this.isVisible(el) && this.isInViewport(el))
        .slice(0, 50);
    } catch {
      return [];
    }
  }

  isVisible(el) {
    try {
      const style = getComputedStyle(el);
      return style.display !== 'none' &&
             style.visibility !== 'hidden' &&
             style.opacity !== '0' &&
             el.offsetWidth > 0 &&
             el.offsetHeight > 0;
    } catch {
      return false;
    }
  }

  isInViewport(el) {
    try {
      const rect = el.getBoundingClientRect();
      return rect.top < window.innerHeight &&
             rect.bottom > 0 &&
             rect.left < window.innerWidth &&
             rect.right > 0;
    } catch {
      return false;
    }
  }

  async click(elementId) {
    const el = this.getElement(elementId);
    if (!el) throw new Error(`Element #${elementId} not found`);

    try {
      el.scrollIntoView({ block: 'center', inline: 'center' });
      await this.moveCursorTo(el);
      // Hover/focus handlers, then a real native click for default actions and frameworks.
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      if (typeof el.click === 'function') el.click();
      else el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    } catch (e) {
      throw new Error(`Click failed on element #${elementId}: ${e.message}`);
    }

    if (el.tagName === 'A' && el.href) {
      return { navigated: true, url: el.href };
    }
    return { clicked: true, tag: el.tagName, text: el.innerText?.slice(0, 50) };
  }

  async type(elementId, text) {
    const el = this.getElement(elementId);
    if (!el) throw new Error(`Element #${elementId} not found`);

    const isInput = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
    if (!isInput) throw new Error(`Element #${elementId} is not typeable`);

    try {
      el.scrollIntoView({ block: 'center', inline: 'center' });
      await this.moveCursorTo(el);
      el.focus();
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.value = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        el.textContent = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } catch (e) {
      throw new Error(`Type failed on element #${elementId}: ${e.message}`);
    }
    return { typed: true, text };
  }

  scroll(direction, amount = 500) {
    try {
      try { this.ensureCursor().style.transform = `translate(${window.innerWidth / 2}px, ${window.innerHeight / 2}px)`; } catch {}
      const delta = direction === 'down' ? amount : -amount;
      window.scrollBy({ top: delta, behavior: 'smooth' });
      return { scrolled: direction, amount: delta };
    } catch (e) {
      throw new Error(`Scroll failed: ${e.message}`);
    }
  }

  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}