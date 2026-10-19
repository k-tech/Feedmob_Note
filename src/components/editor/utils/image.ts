import type { Editor } from '@tiptap/core';

export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';
export const MAX_IMAGE_BYTES = 1024 * 1024;

export function imageSource(input: unknown): string {
  if (typeof input !== 'string') return '';
  const value = input.trim();
  if (/^data:image\/(png|jpeg|webp|gif);base64,[a-z\d+/=\s]+$/i.test(value)) return value;
  try {
    const url = new URL(value);
    if (['http:', 'https:'].includes(url.protocol)) return url.href;
  } catch {}
  return '';
}

export async function readImage(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) throw new Error('请选择 PNG、JPG、WebP 或 GIF 图片。');
  if (file.size > 8 * MAX_IMAGE_BYTES) throw new Error('原图不能超过 8 MB，请先缩小图片。');
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取图片失败，请重新选择。'));
    reader.readAsDataURL(file);
  });
  if (file.type === 'image/gif') {
    if (file.size > MAX_IMAGE_BYTES) throw new Error('GIF 不能超过 1 MB，请先压缩动图。');
    return data;
  }
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('无法解码图片，请换一张图片。'));
    img.src = data;
  });
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('图片尺寸无效。');
  if (file.size <= MAX_IMAGE_BYTES && Math.max(image.naturalWidth, image.naturalHeight) <= 1800) return data;
  const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器无法处理图片，请使用图片链接。');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const result = canvas.toDataURL('image/webp', 0.85);
  if (result.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 100) throw new Error('压缩后图片仍超过 1 MB，请缩小图片。');
  return result;
}

// Insert placeholders synchronously so a later cursor move, delete or navigation
// never sends an asynchronous file read to the wrong block/document.
export function insertImageFiles(editor: Editor, files: File[], pos?: number, replaceSize = 0) {
  const entries = files.map(file => ({ file, id: crypto.randomUUID() }));
  const previous = pos === undefined ? null : editor.state.doc.nodeAt(pos);
  const nodes = entries.map(({ file, id }, index) => ({ type: 'image', attrs: {
    ...(index === 0 && replaceSize && previous?.type.name === 'image' ? previous.attrs : {}),
    uploadId: id, alt: file.name,
  } }));
  const chain = editor.chain().focus();
  if (pos === undefined) chain.insertContent(nodes).run();
  else {
    if (replaceSize) chain.deleteRange({ from: pos, to: pos + replaceSize });
    chain.insertContentAt(pos, nodes).run();
  }
  return Promise.all(entries.map(async ({ file, id }) => {
    let attrs: Record<string, unknown>;
    try { attrs = { src: await readImage(file), error: '' }; }
    catch (error) { attrs = { error: error instanceof Error ? error.message : '读取图片失败。' }; }
    if (editor.isDestroyed) return;
    const tr = editor.state.tr;
    editor.state.doc.descendants((node, at) => {
      if (node.type.name === 'image' && node.attrs.uploadId === id) tr.setNodeMarkup(at, undefined, { ...node.attrs, ...attrs, uploadId: null });
    });
    if (tr.docChanged) editor.view.dispatch(tr);
  }));
}

export function hasPendingImages(editor: Editor) {
  let pending = false;
  editor.state.doc.descendants(node => { if (node.type.name === 'image' && node.attrs.uploadId) pending = true; });
  return pending;
}
