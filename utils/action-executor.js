export class ActionExecutor {
  constructor() {
    this.elementCache = new Map();
  }

  async execute(action) {
    try {
      switch (action.type) {
        case 'CLICK':
          return this.click(action.params?.elementId);
        case 'TYPE':
          return this.type(action.params?.elementId, action.params?.text);
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

  getElement(elementId) {
    const elements = this.findInteractiveElements();
    return elements[elementId - 1];
  }

  findInteractiveElements() {
    try {
      const selector = 'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [onclick], [tabindex]:not([tabindex="-1"])';
      return Array.from(document.querySelectorAll(selector))
        .filter(el => this.isVisible(el) && this.isInViewport(el));
    } catch {
      return [];
    }
  }

  isVisible(el) {
    try {
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetWidth > 0;
    } catch {
      return false;
    }
  }

  isInViewport(el) {
    try {
      const rect = el.getBoundingClientRect();
      return rect.top < window.innerHeight && rect.bottom > 0;
    } catch {
      return false;
    }
  }

  click(elementId) {
    const el = this.getElement(elementId);
    if (!el) throw new Error(`Element #${elementId} not found`);

    try {
      ['mousedown', 'mouseup', 'click'].forEach(type => {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      });
    } catch (e) {
      throw new Error(`Click failed on element #${elementId}: ${e.message}`);
    }

    if (el.tagName === 'A' && el.href) {
      return { navigated: true, url: el.href };
    }
    return { clicked: true, tag: el.tagName, text: el.innerText?.slice(0, 50) };
  }

  type(elementId, text) {
    const el = this.getElement(elementId);
    if (!el) throw new Error(`Element #${elementId} not found`);

    const isInput = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
    if (!isInput) throw new Error(`Element #${elementId} is not typeable`);

    try {
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