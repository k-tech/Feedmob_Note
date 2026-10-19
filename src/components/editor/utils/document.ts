import type { JSONContent } from '@tiptap/core';

export const EMPTY_DOCUMENT: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };

export function parseDocument(value: unknown): JSONContent {
  if (!value) return EMPTY_DOCUMENT;
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== 'object' || (parsed as JSONContent).type !== 'doc') {
    throw new Error('日志内容格式无效，未打开编辑器以避免覆盖原文。');
  }
  const clean = (node: JSONContent): JSONContent => {
    if (!node || typeof node !== 'object' || Array.isArray(node) || typeof node.type !== 'string'
      || (node.content !== undefined && !Array.isArray(node.content))
      || (node.type === 'text' && typeof node.text !== 'string')) {
      throw new Error('日志内容块格式无效，未打开编辑器以避免覆盖原文。');
    }
    // A browser file read cannot survive reload. Keep a recoverable image
    // placeholder instead of restoring a permanently busy upload.
    if (node.type === 'image' && node.attrs?.uploadId) node = { ...node, attrs: { ...node.attrs, uploadId: null } };
    let content = node.content?.map(clean).filter(child => child.type !== 'text' || !!child.text);
    // Older divider commands could persist an invalid empty toggle. Restore
    // its required title without discarding any existing body or attributes.
    if (node.type === 'toggle' && content?.[0]?.type !== 'paragraph') content = [{ type: 'paragraph' }, ...(content ?? [])];
    if (node.type === 'doc' && !content?.length) content = [{ type: 'paragraph' }];
    return { ...node, ...(content ? { content } : {}) };
  };
  return clean(parsed as JSONContent);
}

export interface DocumentSnapshot {
  title: string;
  contentJson: JSONContent;
  tagNames: string[];
  mood: string;
}

export function snapshotKey(snapshot: DocumentSnapshot): string { return JSON.stringify(snapshot); }
