export function sanitizeString(input: string): string {
  if (!input || typeof input !== 'string') {
    return '';
  }
  
  return input
    .replace(/[\u200B-\u200D\uFEFF\u202A-\u202E\u2060-\u206F]/g, '') // Remove control characters
    .trim();
}

export function sanitizeUserInput(data: any): any {
  if (typeof data === 'string') {
    return sanitizeString(data);
  }
  
  if (Array.isArray(data)) {
    return data.map(sanitizeUserInput);
  }
  
  if (data && typeof data === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(data)) {
      sanitized[key] = sanitizeUserInput(value);
    }
    return sanitized;
  }
  
  return data;
}