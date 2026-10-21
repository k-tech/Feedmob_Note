'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { JSONContent } from '@tiptap/core';
import { documentExtensions } from './extensions/document';
import { parseDocument } from './utils/document';

interface LogDocumentProps {
  /** Stored log JSON (string or object). */
  content: unknown;
  /** Shown when the stored document cannot be parsed. */
  fallbackText?: string;
  className?: string;
}

function readDocument(content: unknown): JSONContent | null {
  try { return parseDocument(content); } catch { return null; }
}

/**
 * A submitted log exactly as its author sees it: headings, tasks, columns,
 * HTML previews, images, diagrams and toggles, with every editing control
 * hidden. Toggles still open and close locally for the reader.
 */
export function LogDocument({ content, fallbackText = '', className = '' }: LogDocumentProps) {
  const key = typeof content === 'string' ? content : JSON.stringify(content ?? null);
  const doc = useMemo(() => readDocument(key), [key]);
  const appliedKey = useRef(key);
  const editor = useEditor({
    editable: false,
    immediatelyRender: false,
    extensions: documentExtensions({ editable: false }),
    content: doc ?? undefined,
    editorProps: { attributes: { role: 'document', 'aria-label': '日志正文' } },
  });

  // Feed refreshes (reactions, comments) return new objects for the same
  // stored JSON; only replace the document when that JSON actually changed,
  // so a reader's open toggles survive a refresh.
  useEffect(() => {
    if (!editor || editor.isDestroyed || !doc || appliedKey.current === key) return;
    appliedKey.current = key;
    editor.commands.setContent(doc, false);
  }, [editor, doc, key]);

  if (!doc) return <div className={`log-document is-fallback ${className}`}>{fallbackText || '（日志内容无法显示）'}</div>;
  return <div className={`log-document ${className}`}><EditorContent editor={editor} className="editor-content" /></div>;
}
