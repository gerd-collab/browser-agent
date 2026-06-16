export class ActionExecutor {
  constructor() {
    this.elementCache = new Map();
  }

  async execute(action) {
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
  }

  getElement(elementId) {
    const elements = this.findInteractiveElements();
    return elements[elementId - 1];
  }

  findInteractiveElements() {
    const selector = 'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [onclick], [tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll(selector))
      .filter(el => this.isVisible(el) && this.isInViewport(el));
  }

  isVisible(el) {
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetWidth > 0;
  }

  isInViewport(el) {
    const rect = el.getBoundingClientRect();
    return rect.top < window.innerHeight && rect.bottom > 0;
  }

  click(elementId) {
    const el = this.getElement(elementId);
    if (!el) throw new Error(`Element #${elementId} not found`);

    ['mousedown', 'mouseup', 'click'].forEach(type => {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    });

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

    el.focus();
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      el.textContent = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return { typed: true, text };
  }

  scroll(direction, amount = 500) {
    const delta = direction === 'down' ? amount : -amount;
    window.scrollBy({ top: delta, behavior: 'smooth' });
    return { scrolled: direction, amount: delta };
  }

  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}