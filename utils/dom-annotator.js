export class DOMAnnotator {
  constructor() {
    this.annotationId = 0;
  }

  findInteractiveElements() {
    const selector = [
      'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea',
      '[role="button"]', '[role="link"]', '[role="menuitem"]', '[role="tab"]',
      '[onclick]', '[tabindex]:not([tabindex="-1"])'
    ].join(',');

    return Array.from(document.querySelectorAll(selector))
      .filter(el => this.isVisible(el) && this.isInViewport(el))
      .slice(0, 50);
  }

  isVisible(el) {
    const style = getComputedStyle(el);
    return style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           style.opacity !== '0' &&
           el.offsetWidth > 0 &&
           el.offsetHeight > 0;
  }

  isInViewport(el) {
    const rect = el.getBoundingClientRect();
    return rect.top < window.innerHeight &&
           rect.bottom > 0 &&
           rect.left < window.innerWidth &&
           rect.right > 0;
  }

  async annotateScreenshot(base64Image, elements) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    await new Promise(resolve => {
      img.onload = resolve;
      img.src = `data:image/png;base64,${base64Image}`;
    });

    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    const scaleX = canvas.width / window.innerWidth;
    const scaleY = canvas.height / window.innerHeight;

    elements.forEach((el, idx) => {
      const id = idx + 1;
      const rect = el.getBoundingClientRect();
      const x = (rect.left + rect.width / 2) * scaleX;
      const y = (rect.top + rect.height / 2) * scaleY;
      const radius = Math.max(16, Math.min(rect.width, rect.height) * 0.5 * scaleX);

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 0, 0, 0.9)';
      ctx.fill();

      ctx.font = `bold ${radius}px Arial`;
      ctx.fillStyle = 'white';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(id.toString(), x, y + radius * 0.1);
    });

    return canvas.toDataURL('image/png').split(',')[1];
  }

  remove() {
  }
}