import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { ResizableBlock, blockSizeAttributes } from '../ResizableBlock';
import React, { useEffect, useRef, useState } from 'react';
import { Code2, Eye, GitGraph } from 'lucide-react';

const MermaidComponent = (props: NodeViewProps) => {
  const { node, updateAttributes, editor } = props;
  const editable = editor.isEditable;
  const [isEditing, setIsEditing] = useState(false);
  const [code, setCode] = useState(
    node.attrs.code ||
      'graph TD\n  A[开始] --> B[处理]\n  B --> C[结束]'
  );
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setCode(node.attrs.code ?? ''); }, [node.attrs.code]);

  useEffect(() => {
    let isMounted = true;

    const renderDiagram = async () => {
      if (typeof window === 'undefined') return;

      try {
        setError(null);
        const mermaidModule = (await import('mermaid')).default;
        mermaidModule.initialize({
          startOnLoad: false,
          theme: 'neutral',
          securityLevel: 'strict',
          suppressErrorRendering: true,
        });

        const uniqueId = `mermaid-${Math.random().toString(36).substring(2, 9)}`;
        const { svg: renderedSvg } = await mermaidModule.render(uniqueId, code);
        if (isMounted) {
          setSvg(renderedSvg);
        }
      } catch (err: any) {
        console.warn('Mermaid render warning:', err);
        if (isMounted) {
          setError(err?.message || 'Mermaid 语法解析中...');
        }
      }
    };

    renderDiagram();

    return () => {
      isMounted = false;
    };
  }, [code]);

  const handleCodeChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newCode = e.target.value;
    setCode(newCode);
    updateAttributes({ code: newCode });
  };

  return (
    <ResizableBlock {...props} className="my-4 border border-[var(--border)] rounded-md overflow-hidden bg-[var(--muted)]">
      {/* Header bar: readers see only the rendered diagram */}
      {editable && <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-3 py-2 bg-[var(--muted)] text-sm text-[var(--foreground)] border-b border-[var(--border)]">
        <div className="flex items-center gap-2 font-medium">
          <GitGraph className="w-4 h-4 text-[var(--muted-foreground)]" />
          <span>Mermaid 图表</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setIsEditing(!isEditing)}
            className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1.5 transition ${
              isEditing
                ? 'bg-[var(--background)]  text-[var(--muted-foreground)] font-medium '
                : 'hover:bg-[var(--muted)]  text-[var(--foreground)] '
            }`}
          >
            {isEditing ? <Eye className="w-3.5 h-3.5" /> : <Code2 className="w-3.5 h-3.5" />}
            {isEditing ? '预览图表' : '编辑源码'}
          </button>
        </div>
      </div>}

      {/* Body */}
      {editable && isEditing ? (
        <div className="p-4">
          <textarea
            aria-label="Mermaid 图表源码"
            value={code}
            onChange={handleCodeChange}
            rows={5}
            placeholder="输入 Mermaid 语法，如 graph TD ..."
            className="w-full font-mono text-sm bg-[var(--background)] text-[var(--foreground)] p-3 rounded border border-[var(--border)] outline-none focus:ring-1 focus:ring-[var(--accent)] leading-relaxed"
          />
        </div>
      ) : (
        <div
          ref={containerRef}
          className="resizable-block-body mermaid-viewport p-4 flex min-w-0 flex-col items-center justify-center bg-[var(--background)] min-h-[140px] overflow-auto"
        >
          {error ? (
            <div className="text-red-500 text-sm p-3 bg-red-50 dark:bg-red-950/40 rounded border border-red-200">
              {error}
            </div>
          ) : (
            <div
              className="mermaid-output flex min-w-0 justify-center max-w-full"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          )}
        </div>
      )}
    </ResizableBlock>
  );
};

export const MermaidNode = Node.create({
  name: 'mermaid',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      ...blockSizeAttributes,
      code: {
        default:
          'graph TD\n  A[开始] --> B[处理]\n  B --> C[结束]',
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="mermaid"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'mermaid' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidComponent);
  },
});
