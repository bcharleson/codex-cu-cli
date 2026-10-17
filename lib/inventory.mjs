// First-use tool responses include prose before the emitted JSON inventory.
export function parseInventory(text) {
  for (const match of text.matchAll(/\{\s*"apps"\s*:/g)) {
    const start = match.index;
    let depth = 0, quoted = false, escaped = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try {
          const value = JSON.parse(text.slice(start, i + 1));
          if (Array.isArray(value.apps) && Array.isArray(value.browsers)) return value;
        } catch { /* Continue to the next candidate in the text. */ }
        break;
      }
    }
  }
  throw new Error('cua.getState() returned no valid apps/browsers inventory');
}
