import { DOMAnnotator } from './utils/dom-annotator.js';
import { ActionExecutor } from './utils/action-executor.js';

const annotator = new DOMAnnotator();
const executor = new ActionExecutor();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'ANNOTATE_DOM':
      handleAnnotate(message.image)
        .then(sendResponse)
        .catch(err => {
          console.error('[MiniMax Agent] Annotate error:', err);
          sendResponse({ error: err.message });
        });
      return true;
    case 'EXECUTE_ACTION':
      handleExecute(message.action)
        .then(sendResponse)
        .catch(err => {
          console.error('[MiniMax Agent] Execute error:', err);
          sendResponse({ success: false, error: err.message });
        });
      return true;
    case 'REMOVE_ANNOTATIONS':
      annotator.remove();
      sendResponse({ success: true });
      return true;
  }
});

async function handleAnnotate(base64Image) {
  try {
    const elements = annotator.findInteractiveElements();
    console.log('[MiniMax Agent] Found', elements.length, 'interactive elements');

    let annotatedImage;
    try {
      annotatedImage = await annotator.annotateScreenshot(base64Image, elements);
    } catch (err) {
      console.warn('[MiniMax Agent] Screenshot annotation failed, using original:', err.message);
      annotatedImage = base64Image;
    }

    const elementMap = {};
    elements.forEach((el, idx) => {
      elementMap[idx + 1] = {
        tag: el.tagName.toLowerCase(),
        type: el.type || '',
        text: el.innerText?.slice(0, 100) || '',
        placeholder: el.placeholder || '',
        href: el.href || '',
        isVisible: annotator.isVisible(el),
        rect: el.getBoundingClientRect?.() ?? { top: 0, left: 0, width: 0, height: 0 }
      };
    });

    return { annotatedImage, elementMap };
  } catch (error) {
    console.error('[MiniMax Agent] handleAnnotate failed:', error);
    throw error;
  }
}

async function handleExecute(action) {
  try {
    const result = await executor.execute(action);
    return { success: true, result };
  } catch (error) {
    console.error('[MiniMax Agent] handleExecute failed:', error);
    return { success: false, error: error.message };
  }
}

console.log('[MiniMax Agent] Content script loaded');