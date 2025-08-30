export function detectImageFormat(buffer: Uint8Array): 'jpeg' | 'png' | 'unknown' {
  // JPEG magic bytes: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'jpeg';
  }
  
  // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return 'png';
  }
  
  return 'unknown';
}

export function getImageExtension(format: string): string {
  return format === 'jpeg' ? 'jpg' : format;
}

export function getContentType(format: string): string {
  return format === 'jpeg' ? 'image/jpeg' : 'image/png';
}