import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';

export const TableExtensions = [Table.configure({ resizable: false, renderWrapper: true }), TableRow, TableHeader, TableCell];
