import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import React from 'react';
import { AlertTriangle, CheckCircle, Info, Lightbulb } from 'lucide-react';

const CalloutComponent = ({ node, updateAttributes, editor }: NodeViewProps) => {
  const type = node.attrs.type || 'blocker';

  const typeConfig: Record<string, { icon: any; label: string }> = {
    blocker: {
      icon: AlertTriangle,
      label: '卡点 / Blocker',
    },
    tip: {
      icon: Lightbulb,
      label: '提示 / Tip',
    },
    info: {
      icon: Info,
      label: '信息 / Info',
    },
    success: {
      icon: CheckCircle,
      label: '产出 / Goal',
    },
  };

  const current = typeConfig[type] || typeConfig.blocker;
  const Icon = current.icon;

  return (
    <NodeViewWrapper className={`custom-callout callout-${type} border border-[var(--border)] transition-colors`}>
      <div contentEditable={false} className="flex flex-col items-center select-none pt-0.5 shrink-0">
        <Icon className="w-5 h-5 text-current" aria-hidden="true" />
        {editor.isEditable ? <select
          aria-label="提示块类型"
          value={type}
          onChange={(e) => updateAttributes({ type: e.target.value })}
          className="mt-1 text-xs bg-transparent border-0 text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer outline-none font-medium"
        >
          <option value="blocker">卡点</option>
          <option value="tip">提示</option>
          <option value="info">信息</option>
          <option value="success">目标</option>
        </select>
          : <span className="mt-1 text-xs font-medium text-[var(--muted-foreground)]">{{ blocker: '卡点', tip: '提示', info: '信息', success: '目标' }[type as string] ?? '卡点'}</span>}
      </div>
      <div className="flex-1 min-w-0 text-base leading-relaxed">
        <NodeViewContent className="outline-none text-[var(--foreground)]" />
      </div>
    </NodeViewWrapper>
  );
};


export const CalloutNode = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  draggable: true,

  addAttributes() {
    return {
      type: {
        default: 'blocker',
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="callout"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'callout' }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutComponent);
  },
});
