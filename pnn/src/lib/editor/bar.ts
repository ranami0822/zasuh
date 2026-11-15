import { redo, undo } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import type { IconName } from '../icons';
import { insertRule, insertText, today, toggleLinePrefix, toggleWrap } from './commands';

/**
 * 装飾バーの中身。表示は、アイコン（icon）か、文字（label）のどちらか。
 * 本文に入れる文字（♡ など）は、アイコンではなく内容なので、ここに置く。
 */
export interface BarItem {
	id: string;
	title: string;
	icon?: IconName;
	label?: string;
	run: (v: EditorView) => void;
	/** 前の群との間を広げる */
	gap?: boolean;
}

const snippet = (id: string, text: string, caret?: number, title = text): BarItem => ({
	id,
	title,
	label: text,
	run: (v) => insertText(v, text, caret)
});

export const bar: BarItem[] = [
	{ id: 'undo', title: '戻す', icon: 'undo', run: (v) => void undo(v) },
	{ id: 'redo', title: '進む', icon: 'redo', run: (v) => void redo(v) },
	{ id: 'h', title: '見出し', label: '見出し', run: (v) => toggleLinePrefix(v, '# ') },
	{ id: 'b', title: '太字', label: '太字', run: (v) => toggleWrap(v, '**') },
	{ id: 'i', title: '傾き', label: '傾き', run: (v) => toggleWrap(v, '*') },
	{ id: 's', title: '取り消し線', label: '取消', run: (v) => toggleWrap(v, '~~') },
	{ id: 'q', title: '引用', label: '引用', run: (v) => toggleLinePrefix(v, '> ') },
	{ id: 'ul', title: '箇条書き', label: '箇条', run: (v) => toggleLinePrefix(v, '- ') },
	{ id: 'hr', title: '区切り線', label: '区切り', run: (v) => insertRule(v) },
	{ ...snippet('kagi', '「」', 1), gap: true },
	snippet('nijuu', '『』', 1),
	snippet('tenten', '……'),
	snippet('kome', '※'),
	snippet('heart-o', '♡'),
	snippet('heart', '❤'),
	{ id: 'date', title: '今日の日付', label: '日付', run: (v) => insertText(v, today()) }
];
