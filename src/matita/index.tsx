import {
  createContext,
  memo,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Image from 'next/image';

export enum EditorFamilyType {
  Editor = 'Editor',
  Block = 'Block',
  Inline = 'Inline',
}

export enum BlockNodeType {
  Table = 'Block/Table',
  Image = 'Block/Image',
  Paragraph = 'Block/Paragraph',
}

export enum InlineNodeType {
  Text = 'Inline/Text',
  Mention = 'Inline/Mention',
}

enum SelectionType {
  Table,
  Block,
}

interface TableCellPoint {
  rowIndex: number;
  columnIndex: number;
}

interface TableSelection {
  type: SelectionType.Table;
  editorId: string;
  tableId: string;
  startCell: TableCellPoint;
  endCell: TableCellPoint;
}

interface TableCell {
  value: EditorValue;
  id: string;
}

interface TableRow {
  cells: TableCell[];
  id: string;
}

interface TableNode {
  type: BlockNodeType.Table;
  isBlock: true;
  rows: TableRow[];
  numColumns: number;
  id: string;
}

enum BlockSelectionPointType {
  OtherBlock,
  Paragraph,
}

interface BlockPoint {
  type: BlockSelectionPointType.OtherBlock;
  blockId: string;
}

interface ParagraphPoint {
  type: BlockSelectionPointType.Paragraph;
  blockId: string;
  offset: number;
}

interface BlockSelection {
  type: SelectionType.Block;
  editorId: string;
  start: BlockPoint | ParagraphPoint;
  end: BlockPoint | ParagraphPoint;
}

interface ImageNode {
  type: BlockNodeType.Image;
  isBlock: true;
  src: string;
  caption: string;
  id: string;
}

export enum ParagraphStyleType {
  Default,
  Heading,
  Title,
  Quote,
  PullQuote,
  BulletList,
  NumberedList,
}

interface DefaultParagraphStyle {
  type: ParagraphStyleType.Default;
}
interface HeadingParagraphStyle {
  type: ParagraphStyleType.Heading;
}
interface TitleParagraphStyle {
  type: ParagraphStyleType.Title;
}
interface QuoteParagraphStyle {
  type: ParagraphStyleType.Quote;
}
interface PullQuoteParagraphStyle {
  type: ParagraphStyleType.PullQuote;
}

interface BulletListParagraphStyle {
  type: ParagraphStyleType.BulletList;
  listId: string;
}
interface NumberedListParagraphStyle {
  type: ParagraphStyleType.NumberedList;
  listId: string;
}

type ParagraphStyle =
  | DefaultParagraphStyle
  | HeadingParagraphStyle
  | TitleParagraphStyle
  | QuoteParagraphStyle
  | PullQuoteParagraphStyle
  | BulletListParagraphStyle
  | NumberedListParagraphStyle;

interface ParagraphNode {
  type: BlockNodeType.Paragraph;
  isBlock: false;
  children: InlineNode[];
  style: ParagraphStyle;
  id: string;
}

export enum TextStyleType {
  Bold = 2 ** 0,
  Italic = 2 ** 1,
  Underline = 2 ** 2,
  InlineCode = 2 ** 3,
  Strikethrough = 2 ** 4,
  Superscript = 2 ** 5,
  Subscript = 2 ** 6,
}

interface TextStyle {
  flags: number;
}

interface TextNode {
  type: InlineNodeType.Text;
  isBlock: false;
  text: string;
  style: TextStyle;
  id: string;
}

interface MentionNode {
  type: InlineNodeType.Mention;
  isBlock: true;
  username: string;
  id: string;
}

type BlockNode = ImageNode | TableNode | ParagraphNode;
type InlineNode = TextNode | MentionNode;

export interface EditorController {
  value: EditorValue;
  paragraphStyle: ParagraphStyle;
  textStyle: TextStyle;
  selection: Selection | null;
  makeId(): string;
}

export interface EditorValue {
  blocks: BlockNode[];
  id: string;
}

export function makeParagraph(
  children: InlineNode[],
  style: ParagraphStyle,
  id: string,
): ParagraphNode {
  return {
    type: BlockNodeType.Paragraph,
    isBlock: false,
    children,
    style,
    id,
  };
}

export function makeDefaultParagraph(
  children: InlineNode[],
  id: string,
): ParagraphNode {
  return makeParagraph(children, { type: ParagraphStyleType.Default }, id);
}
export function makeHeadingParagraph(
  children: InlineNode[],
  id: string,
): ParagraphNode {
  return makeParagraph(children, { type: ParagraphStyleType.Heading }, id);
}
export function makeTitleParagraph(
  children: InlineNode[],
  id: string,
): ParagraphNode {
  return makeParagraph(children, { type: ParagraphStyleType.Title }, id);
}
export function makeQuoteParagraph(
  children: InlineNode[],
  id: string,
): ParagraphNode {
  return makeParagraph(children, { type: ParagraphStyleType.Quote }, id);
}
export function makePullQuoteParagraph(
  children: InlineNode[],
  id: string,
): ParagraphNode {
  return makeParagraph(children, { type: ParagraphStyleType.PullQuote }, id);
}
export function makeBulletListParagraph(
  children: InlineNode[],
  listId: string,
  id: string,
): ParagraphNode {
  return makeParagraph(
    children,
    { type: ParagraphStyleType.BulletList, listId },
    id,
  );
}
export function makeNumberedListParagraph(
  children: InlineNode[],
  listId: string,
  id: string,
): ParagraphNode {
  return makeParagraph(
    children,
    { type: ParagraphStyleType.NumberedList, listId },
    id,
  );
}

export function makeTable(
  rows: TableRow[],
  numColumns: number,
  id: string,
): TableNode {
  return {
    type: BlockNodeType.Table,
    isBlock: true,
    rows,
    numColumns,
    id,
  };
}

export function makeTableRow(cells: TableCell[], id: string): TableRow {
  return {
    cells,
    id,
  };
}

export function makeTableCell(value: EditorValue, id: string): TableCell {
  return {
    value,
    id,
  };
}

export function makeImage(src: string, caption: string, id: string): ImageNode {
  return {
    type: BlockNodeType.Image,
    isBlock: true,
    src,
    caption,
    id,
  };
}

export function makeText(text: string, style: TextStyle, id: string): TextNode {
  return {
    type: InlineNodeType.Text,
    isBlock: false,
    text,
    style,
    id,
  };
}

export function makeMention(
  text: string,
  username: string,
  id: string,
): MentionNode {
  return {
    type: InlineNodeType.Mention,
    isBlock: true,
    username,
    id,
  };
}

export function makeDefaultText(text: string, id: string): TextNode {
  return makeText(text, { flags: 0 }, id);
}

export function makeEditorValue(blocks: BlockNode[], id: string): EditorValue {
  return {
    blocks,
    id,
  };
}

function makeKey(type: string, id: string): string {
  return `${type}@${id}`;
}

function ReactTableNode({ value }: { value: TableNode }): JSX.Element {
  const selectedEditors = useContext(SelectedEditorsContext);
  const hasSelectedCell = value.rows.some((row) =>
    row.cells.some((cell) => selectedEditors.includes(cell.value.id)),
  );
  return (
    <div>
      <table
        data-family={EditorFamilyType.Block}
        data-type={BlockNodeType.Table}
        data-id={value.id}
      >
        <tbody>
          {value.rows.map((row) => {
            return (
              <tr key={row.id}>
                {row.cells.map((cell, idx) => {
                  return (
                    <td
                      key={cell.id}
                      className={
                        selectedEditors.includes(cell.value.id)
                          ? 'selected'
                          : hasSelectedCell
                          ? 'not-selected'
                          : undefined
                      }
                    >
                      <ReactEditorValue value={cell.value} />
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ReactBlockImageNode({ value }: { value: ImageNode }): JSX.Element {
  return (
    <Image
      data-family={EditorFamilyType.Block}
      data-type={BlockNodeType.Image}
      data-id={value.id}
      src={value.src}
      alt={value.caption}
    />
  );
}

function ReactParagraphNode({ value }: { value: ParagraphNode }): JSX.Element {
  const isEmpty =
    value.children.length === 1 &&
    !value.children[0].isBlock &&
    value.children[0].text === '';
  const children = isEmpty ? (
    <br />
  ) : (
    value.children.map((child) => {
      switch (child.type) {
        case InlineNodeType.Text: {
          return (
            <ReactTextNode
              data-family={EditorFamilyType.Inline}
              value={child}
              key={child.id}
            />
          );
        }
      }
    })
  );
  switch (value.style.type) {
    case ParagraphStyleType.Default: {
      return (
        <p
          data-family={EditorFamilyType.Block}
          data-type={BlockNodeType.Paragraph}
          data-empty-paragraph={isEmpty}
          data-id={value.id}
        >
          {children}
        </p>
      );
    }
    case ParagraphStyleType.Heading: {
      return (
        <h1
          data-family={EditorFamilyType.Block}
          data-type={BlockNodeType.Paragraph}
          data-empty-paragraph={isEmpty}
          data-id={value.id}
        >
          {children}
        </h1>
      );
    }
    case ParagraphStyleType.Title: {
      return (
        <h2
          data-family={EditorFamilyType.Block}
          data-type={BlockNodeType.Paragraph}
          data-empty-paragraph={isEmpty}
          data-id={value.id}
        >
          {children}
        </h2>
      );
    }
    case ParagraphStyleType.Quote: {
      return (
        <blockquote
          data-family={EditorFamilyType.Block}
          data-type={BlockNodeType.Paragraph}
          data-empty-paragraph={isEmpty}
          data-id={value.id}
        >
          {children}
        </blockquote>
      );
    }
    case ParagraphStyleType.PullQuote: {
      return (
        <blockquote
          data-family={EditorFamilyType.Block}
          data-type={BlockNodeType.Paragraph}
          data-empty-paragraph={isEmpty}
          data-id={value.id}
        >
          {children}
        </blockquote>
      );
    }
    case ParagraphStyleType.BulletList: {
      return (
        <li
          data-family={EditorFamilyType.Block}
          data-type={BlockNodeType.Paragraph}
          data-empty-paragraph={isEmpty}
          data-id={value.id}
        >
          {children}
        </li>
      );
    }
    case ParagraphStyleType.NumberedList: {
      return (
        <li
          data-family={EditorFamilyType.Block}
          data-type={BlockNodeType.Paragraph}
          data-empty-paragraph={isEmpty}
          data-id={value.id}
        >
          {children}
        </li>
      );
    }
  }
}

function ReactTextNode({ value }: { value: TextNode }): JSX.Element {
  let text: JSX.Element | string = value.text;
  if (value.style.flags & TextStyleType.Bold) {
    text = <b>{text}</b>;
  }
  if (value.style.flags & TextStyleType.Italic) {
    text = <i>{text}</i>;
  }
  if (value.style.flags & TextStyleType.Underline) {
    text = <u>{text}</u>;
  }
  if (value.style.flags & TextStyleType.InlineCode) {
    text = <code>{text}</code>;
  }
  if (value.style.flags & TextStyleType.Strikethrough) {
    text = <del>{text}</del>;
  }
  if (value.style.flags & TextStyleType.Superscript) {
    text = <sup>{text}</sup>;
  }
  if (value.style.flags & TextStyleType.Subscript) {
    text = <sub>{text}</sub>;
  }
  return (
    <span
      data-family={EditorFamilyType.Inline}
      data-type={InlineNodeType.Text}
      data-id={value.id}
    >
      {text}
    </span>
  );
}

function ReactEditorValue_({ value }: { value: EditorValue }): JSX.Element {
  return (
    <div data-family={EditorFamilyType.Editor} data-id={value.id}>
      {value.blocks.map((block) => {
        switch (block.type) {
          case BlockNodeType.Image: {
            return <ReactBlockImageNode value={block} key={block.id} />;
          }
          case BlockNodeType.Table: {
            return <ReactTableNode value={block} key={block.id} />;
          }
          case BlockNodeType.Paragraph: {
            return <ReactParagraphNode value={block} key={block.id} />;
          }
        }
      })}
    </div>
  );
}
const ReactEditorValue = memo(ReactEditorValue_);

/**
 * From a DOM selection's `node` and `offset`, normalize so that it always
 * refers to a text node.
 */

function normalizeNodeAndOffset(node: Node, offset: number): [Node, number] {
  // If it's an element node, its offset refers to the index of its children
  // including comment nodes, so try to find the right text child node.
  if (node.nodeType === 1 && node.childNodes.length) {
    const isLast = offset === node.childNodes.length;
    const direction = isLast ? Direction.Forwards : Direction.Backwards;
    const index = isLast ? offset - 1 : offset;
    node = getEditableChild(node, index, direction);

    // If the node has children, traverse until we have a leaf node. Leaf nodes
    // can be either text nodes, or other void DOM nodes.
    while (node.nodeType === 1 && node.childNodes.length) {
      const i = isLast ? node.childNodes.length - 1 : 0;
      node = getEditableChild(node, i, direction);
    }

    if (isLast) {
      const { textContent } = node;
      offset = textContent ? textContent.length : 0;
    } else {
      offset = 0;
    }
  }

  // Return the node and offset.
  return [node, offset];
}

/**
 * Get the nearest editable child at `index` in a `parent`, preferring
 * `direction`.
 */

function getEditableChild(
  parent: Node,
  index: number,
  direction: Direction.Forwards | Direction.Backwards,
): Node {
  const { childNodes } = parent;
  let child = childNodes[index];
  let i = index;
  let triedForward = false;
  let triedBackward = false;

  // While the child is a comment node, or an element node with no children,
  // keep iterating to find a sibling non-void, non-comment node.
  while (
    child.nodeType === 8 ||
    (child.nodeType === 1 && child.childNodes.length === 0) ||
    (child.nodeType === 1 &&
      (child as Element).getAttribute('contenteditable') === 'false')
  ) {
    if (triedForward && triedBackward) {
      break;
    }

    if (i >= childNodes.length) {
      triedForward = true;
      i = index - 1;
      direction = Direction.Backwards;
      continue;
    }

    if (i < 0) {
      triedBackward = true;
      i = index + 1;
      direction = Direction.Forwards;
      continue;
    }

    child = childNodes[i];

    if (direction === Direction.Forwards) {
      i++;
    } else {
      i--;
    }
  }

  return child;
}

function closest(node: Node, selectors: string): Element | null {
  if ('closest' in node) {
    return (node as Element).closest(selectors);
  }
  return node.parentElement!.closest(selectors);
}

export type Selection = BlockSelection | TableSelection;

enum FindPointResultType {
  Block,
}
type FindPointResult = {
  type: FindPointResultType.Block;
  point: BlockPoint | ParagraphPoint;
  editorId: string;
};

function findPoint(
  value: EditorValue,
  container: Node,
  offset: number,
): FindPointResult {
  const [nearestNode, nearestOffset] = normalizeNodeAndOffset(
    container,
    offset,
  );
  const nearestEditorNode = closest(
    nearestNode,
    `[data-family="${EditorFamilyType.Editor}"]`,
  )!;
  const editorId = nearestEditorNode.getAttribute('data-id')!;
  const nearestDocNode = closest(nearestNode, '[data-family]')!;
  if (nearestDocNode.hasAttribute('data-empty-paragraph')) {
    const paragraphId = nearestDocNode.getAttribute('data-id')!;
    return {
      type: FindPointResultType.Block,
      point: {
        type: BlockSelectionPointType.Paragraph,
        blockId: paragraphId,
        offset: 0,
      },
      editorId,
    };
  }
  const nearestDocNodeType = nearestDocNode.getAttribute('data-type')!;
  if (nearestDocNodeType === InlineNodeType.Text) {
    const textId = nearestDocNode.getAttribute('data-id')!;
    const nearestParagraphNode = nearestDocNode.closest(
      `[data-type="${BlockNodeType.Paragraph}"]`,
    )!;
    const paragraphId = nearestParagraphNode.getAttribute('data-id')!;
    const offset = walkEditorValues<number | undefined>(
      value,
      (subValue, _data, _ids) => {
        const idx = subValue.blocks.findIndex(
          (block) => block.id === paragraphId,
        );
        if (idx === -1) {
          return {
            stop: false,
            data: undefined,
          };
        }
        const para = subValue.blocks[idx];
        if (para.isBlock) {
          throw new Error();
        }
        let offset = 0;
        for (let i = 0; i < para.children.length; i++) {
          const node = para.children[i];
          if (node.id === textId) {
            offset += nearestOffset;
            break;
          }
          offset += node.isBlock ? 1 : node.text.length;
        }
        return {
          stop: true,
          data: offset,
        };
      },
      undefined,
      false,
    ).retValue;
    if (offset === undefined) {
      throw new Error();
    }
    return {
      type: FindPointResultType.Block,
      point: {
        type: BlockSelectionPointType.Paragraph,
        blockId: paragraphId,
        offset,
      },
      editorId,
    };
  }
  throw new Error('none found');
}

function walkEditorValues<T>(
  editor: EditorValue,
  onEditorValue: (
    value: EditorValue,
    data: T,
    ids: { parentEditor: EditorValue; parentBlock: BlockNode } | null,
  ) => { data: T; newValue?: EditorValue; stop: boolean },
  initialData: T,
  willMap: boolean,
): { didStop: boolean; retValue: T; mappedEditor: EditorValue } {
  let didStop = false;
  let retValue: T = initialData;
  function walk(value: EditorValue, data: T): void {
    value.blocks.forEach((block) => {
      if (block.type === BlockNodeType.Table) {
        for (let i = 0; i < block.rows.length && !didStop; i++) {
          let row = block.rows[i];
          for (let j = 0; j < row.cells.length && !didStop; j++) {
            let cell = row.cells[j];
            const {
              data: newData,
              newValue,
              stop,
            } = onEditorValue(cell.value, data, {
              parentEditor: value,
              parentBlock: block,
            });
            if (newValue) {
              if (!willMap) {
                throw new Error();
              }
              row.cells[j].value = newValue;
            }
            if (stop) {
              didStop = true;
              retValue = newData;
            } else {
              walk(cell.value, newData);
            }
          }
        }
      }
    });
  }
  let { data, newValue, stop } = onEditorValue(editor, initialData, null);
  if (newValue) {
    if (!willMap) {
      throw new Error();
    }
    return { didStop: false, retValue: data, mappedEditor: newValue };
  }
  if (stop) {
    return { didStop: true, retValue: data, mappedEditor: editor };
  }
  let mappedEditor = JSON.parse(JSON.stringify(editor)) as EditorValue;
  walk(mappedEditor, data);
  return { didStop, retValue, mappedEditor };
}

function findParentEditors(
  value: EditorValue,
  editorId: string,
): { editorId: string; blockId: string }[] {
  if (value.id === editorId) {
    return [];
  }
  return walkEditorValues<{ editorId: string; blockId: string }[]>(
    value,
    (editor, parentEditors, ids) => {
      if (ids === null) {
        return { data: parentEditors, stop: false };
      }
      const parentEditorsNew = [
        ...parentEditors,
        { editorId: ids.parentEditor.id, blockId: ids.parentBlock.id },
      ];
      if (editor.id === editorId) {
        return { data: parentEditorsNew, stop: true };
      }
      return { data: parentEditorsNew, stop: false };
    },
    [],
    false,
  ).retValue;
}

function findSelection(
  value: EditorValue,
  range: Range | StaticRange,
  isBackwards: boolean,
): Selection {
  const startPoint = findPoint(value, range.startContainer, range.startOffset);
  const endPoint = findPoint(value, range.endContainer, range.endOffset);
  if (startPoint.editorId === endPoint.editorId) {
    return {
      type: SelectionType.Block,
      editorId: startPoint.editorId,
      start: isBackwards ? endPoint.point : startPoint.point,
      end: isBackwards ? startPoint.point : endPoint.point,
    };
  }
  function getParentTables(
    editorId: string,
  ): { editor: EditorValue; table: TableNode; cell: EditorValue }[] {
    return walkEditorValues<
      {
        editor: EditorValue;
        table: TableNode;
        cell: EditorValue;
      }[]
    >(
      value,
      (editor, data, ids) => {
        if (ids?.parentBlock.type === BlockNodeType.Table) {
          const newData = [
            ...data,
            {
              editor: ids.parentEditor,
              table: ids.parentBlock,
              cell: editor,
            },
          ];
          return {
            stop: editor.id === editorId,
            data: newData,
          };
        }
        return {
          stop: editor.id === editorId,
          data,
        };
      },
      [],
      false,
    ).retValue;
  }
  function getTableCellPoint(
    table: TableNode,
    editorId: string,
  ): TableCellPoint {
    const row = table.rows.find((row) =>
      row.cells.some((cell) => cell.value.id === editorId),
    )!;
    const rowIndex = table.rows.indexOf(row);
    const columnIndex = row.cells.findIndex(
      (cell) => cell.value.id === editorId,
    );
    return { rowIndex, columnIndex };
  }
  const startParentTables = getParentTables(startPoint.editorId);
  const endParentTables = getParentTables(endPoint.editorId);
  for (let i = startParentTables.length - 1; i >= 0; i--) {
    const commonTableStart = startParentTables[i];
    const commonTableEnd = endParentTables.find(
      ({ table }) => table.id === commonTableStart.table.id,
    );
    if (!commonTableEnd) {
      continue;
    }
    if (commonTableStart.cell.id === commonTableEnd.cell.id) {
      let start: BlockPoint | ParagraphPoint;
      if (i < startParentTables.length - 1) {
        let startTable = startParentTables[i + 1];
        start = {
          type: BlockSelectionPointType.OtherBlock,
          blockId: startTable.table.id,
        };
      } else {
        start = startPoint.point;
      }
      let end: BlockPoint | ParagraphPoint;
      const commonTableEndIndex = endParentTables.indexOf(commonTableEnd);
      if (commonTableEndIndex < endParentTables.length - 1) {
        let endTable = endParentTables[i + 1];
        end = {
          type: BlockSelectionPointType.OtherBlock,
          blockId: endTable.table.id,
        };
      } else {
        end = endPoint.point;
      }
      return {
        type: SelectionType.Block,
        editorId: commonTableStart.cell.id,
        start: isBackwards ? end : start,
        end: isBackwards ? start : end,
      };
    }
    const startCell = getTableCellPoint(
      commonTableStart.table,
      commonTableStart.cell.id,
    );
    const endCell = getTableCellPoint(
      commonTableStart.table,
      commonTableEnd.cell.id,
    );
    return {
      type: SelectionType.Table,
      editorId: commonTableStart.editor.id,
      tableId: commonTableStart.table.id,
      startCell: isBackwards ? endCell : startCell,
      endCell: isBackwards ? startCell : endCell,
    };
  }
  const startParentEditors = findParentEditors(value, startPoint.editorId);
  if (startParentEditors.length === 0) {
    if (startPoint.type === FindPointResultType.Block) {
      startParentEditors.unshift({
        editorId: value.id,
        blockId: startPoint.point.blockId,
      });
    }
  }
  const endParentEditors = findParentEditors(value, endPoint.editorId);
  if (endParentEditors.length === 0) {
    if (endPoint.type === FindPointResultType.Block) {
      endParentEditors.unshift({
        editorId: value.id,
        blockId: endPoint.point.blockId,
      });
    }
  }
  for (let i = startParentEditors.length - 1; i >= 0; i--) {
    const commonEditorEnd = endParentEditors.find(
      ({ editorId }) => startParentEditors[i].editorId === editorId,
    );
    if (!commonEditorEnd) {
      continue;
    }
    let startBlockPoint: BlockPoint | ParagraphPoint;
    let endBlockPoint: BlockPoint | ParagraphPoint;
    if (startPoint.editorId === commonEditorEnd.editorId) {
      startBlockPoint = startPoint.point;
    } else {
      startBlockPoint = {
        type: BlockSelectionPointType.OtherBlock,
        blockId: startParentEditors[i].blockId,
      };
    }
    if (endPoint.editorId === commonEditorEnd.editorId) {
      endBlockPoint = endPoint.point;
    } else {
      endBlockPoint = {
        type: BlockSelectionPointType.OtherBlock,
        blockId: commonEditorEnd.blockId,
      };
    }
    return {
      type: SelectionType.Block,
      editorId: commonEditorEnd.editorId,
      start: isBackwards ? endBlockPoint : startBlockPoint,
      end: isBackwards ? startBlockPoint : endBlockPoint,
    };
  }
  throw new Error();
}

enum Direction {
  Forwards,
  Collapsed,
  Backwards,
}

function getDirection(value: EditorValue, selection: Selection): Direction {
  if (selection.type === SelectionType.Block) {
    const editor = walkEditorValues<EditorValue | undefined>(
      value,
      (subValue, _data, _ids) => {
        if (subValue.id === selection.editorId) {
          return {
            stop: true,
            data: subValue,
          };
        }
        return {
          stop: false,
          data: undefined,
        };
      },
      undefined,
      false,
    ).retValue!;
    const startIndex = editor.blocks.findIndex(
      (block) => block.id === selection.start.blockId,
    );
    const endIndex = editor.blocks.findIndex(
      (block) => block.id === selection.end.blockId,
    );
    if (endIndex > startIndex) {
      return Direction.Forwards;
    }
    if (startIndex > endIndex) {
      return Direction.Backwards;
    }
    if (selection.start.type === BlockSelectionPointType.OtherBlock) {
      return Direction.Collapsed;
    }
    if ((selection.end as ParagraphPoint).offset > selection.start.offset) {
      return Direction.Forwards;
    }
    if ((selection.end as ParagraphPoint).offset === selection.start.offset) {
      return Direction.Collapsed;
    }
    {
      return Direction.Backwards;
    }
  }
  if (
    selection.startCell.rowIndex > selection.endCell.rowIndex ||
    (selection.startCell.rowIndex === selection.endCell.rowIndex &&
      selection.startCell.columnIndex > selection.endCell.columnIndex)
  ) {
    return Direction.Backwards;
  }
  if (
    selection.startCell.rowIndex === selection.endCell.rowIndex &&
    selection.startCell.columnIndex === selection.endCell.columnIndex
  ) {
    return Direction.Collapsed;
  }
  return Direction.Forwards;
}

function orderSelection(value: EditorValue, selection: Selection): Selection {
  if (selection.type === SelectionType.Block) {
    const editor = walkEditorValues<EditorValue | undefined>(
      value,
      (subValue, _data, _ids) => {
        if (subValue.id === selection.editorId) {
          return {
            stop: true,
            data: subValue,
          };
        }
        return {
          stop: false,
          data: undefined,
        };
      },
      undefined,
      false,
    ).retValue!;
    const startIndex = editor.blocks.findIndex(
      (block) => block.id === selection.start.blockId,
    );
    const endIndex = editor.blocks.findIndex(
      (block) => block.id === selection.end.blockId,
    );
    if (endIndex > startIndex) {
      return selection;
    } else if (startIndex > endIndex) {
      return {
        type: SelectionType.Block,
        editorId: selection.editorId,
        start: selection.end,
        end: selection.start,
      };
    }
    if (selection.start.type === BlockSelectionPointType.OtherBlock) {
      return selection;
    }
    if ((selection.end as ParagraphPoint).offset >= selection.start.offset) {
      return selection;
    }
    return {
      type: SelectionType.Block,
      editorId: selection.editorId,
      start: selection.end,
      end: selection.start,
    };
  }
  if (
    selection.startCell.rowIndex > selection.endCell.rowIndex ||
    (selection.startCell.rowIndex === selection.endCell.rowIndex &&
      selection.startCell.columnIndex > selection.endCell.columnIndex)
  ) {
    return {
      type: SelectionType.Table,
      editorId: selection.editorId,
      tableId: selection.tableId,
      startCell: selection.endCell,
      endCell: selection.startCell,
    };
  }
  return selection;
}

function isCollapsed(selection: Selection): boolean {
  return (
    selection.type === SelectionType.Block &&
    selection.start.blockId === selection.end.blockId &&
    selection.start.type === BlockSelectionPointType.Paragraph &&
    selection.start.offset === (selection.end as ParagraphPoint).offset
  );
}

function fixParagraph(paragraph: ParagraphNode): ParagraphNode {
  if (getParagraphLength(paragraph) === 0) {
    return makeParagraph(
      [
        makeText(
          '',
          (paragraph.children[0] as TextNode).style,
          paragraph.children[0].id,
        ),
      ],
      paragraph.style,
      paragraph.id,
    );
  }
  if (paragraph.children.some((child) => !child.isBlock && child.text === '')) {
    return makeParagraph(
      paragraph.children.filter((child) => child.isBlock || child.text !== ''),
      paragraph.style,
      paragraph.id,
    );
  }
  return paragraph;
}

enum ContainType {
  Separate,
  SameLevel,
  Contained,
}
type ContainData =
  | { type: ContainType.SameLevel; editor: EditorValue }
  | { type: ContainType.Separate | ContainType.Contained };

function compareSelectionToBlockRange(
  value: EditorValue,
  selection: Selection,
  range: BlockSelection,
): ContainData {
  const res = walkEditorValues<ContainData>(
    value,
    (subValue, data, ids) => {
      if (ids?.parentEditor.id === range.editorId) {
        const startBlockIndex = ids.parentEditor.blocks.findIndex(
          (block) => block.id === range.start.blockId,
        );
        const parentBlockIndex = ids.parentEditor.blocks.findIndex(
          (block) => block.id === ids.parentBlock.id,
        );
        const endBlockIndex = ids.parentEditor.blocks.findIndex(
          (block) => block.id === range.end.blockId,
        );
        if (
          startBlockIndex <= parentBlockIndex &&
          parentBlockIndex <= endBlockIndex
        ) {
          return {
            stop: subValue.id === selection.editorId,
            data: { type: ContainType.Contained },
          };
        }
      }
      if (subValue.id === selection.editorId) {
        return {
          stop: true,
          data:
            subValue.id === range.editorId
              ? {
                  type: ContainType.SameLevel,
                  editor: subValue,
                }
              : data,
        };
      }
      return {
        stop: false,
        data,
      };
    },
    { type: ContainType.Separate },
    false,
  );
  if (!res.didStop) {
    throw new Error();
  }
  return res.retValue;
}

function removeTextFromParagraph(
  paragraph: ParagraphNode,
  startOffset: number,
  endOffset: number,
): ParagraphNode {
  const newParagraphChildren = [];
  let len = 0;
  for (let i = 0; i < paragraph.children.length; i++) {
    const child = paragraph.children[i];
    let prevLen = len;
    len += child.isBlock ? 1 : child.text.length;
    if (startOffset >= len || endOffset <= prevLen) {
      newParagraphChildren.push(child);
      continue;
    }
    if (startOffset > prevLen || endOffset < len) {
      const text = child as TextNode;
      console.log(startOffset, endOffset, prevLen, len, text.text);
      newParagraphChildren.push(
        makeText(
          text.text.substring(0, startOffset - prevLen) +
            text.text.substring(endOffset - prevLen),
          text.style,
          text.id,
        ),
      );
    }
  }
  if (newParagraphChildren.length === 0) {
    newParagraphChildren.push(
      makeText(
        '',
        (paragraph.children[0] as TextNode).style,
        (paragraph.children[0] as TextNode).id,
      ),
    );
  }
  return fixParagraph(
    makeParagraph(newParagraphChildren, paragraph.style, paragraph.id),
  );
}

function fixSelection(value: EditorValue, selection: Selection): Selection {
  if (
    selection.type === SelectionType.Table ||
    selection.start.type !== BlockSelectionPointType.OtherBlock ||
    selection.start.blockId !== selection.end.blockId
  ) {
    return selection;
  }
  return walkEditorValues<Selection | undefined>(
    value,
    (subValue, _data, _ids) => {
      if (subValue.id !== selection.editorId) {
        return {
          stop: false,
          data: undefined,
        };
      }
      const block = subValue.blocks.find(
        (block) => block.id === selection.start.blockId,
      )!;
      if (block.type === BlockNodeType.Table) {
        return {
          stop: true,
          data: {
            type: SelectionType.Table,
            editorId: subValue.id,
            tableId: block.id,
            startCell: { rowIndex: 0, columnIndex: 0 },
            endCell: {
              rowIndex: block.rows.length - 1,
              columnIndex: block.numColumns - 1,
            },
          },
        };
      }
      return {
        stop: true,
        data: selection,
      };
    },
    undefined,
    false,
  ).retValue!;
}

function removeSelection(
  editorCtrl: EditorController,
  selection: Selection,
): {
  value: EditorValue;
  mapSelection: (selection: Selection, isCursor: boolean) => Selection;
} {
  const { value } = editorCtrl;
  if (isCollapsed(selection)) {
    return {
      value,
      mapSelection(selection) {
        return selection;
      },
    };
  }
  const range = orderSelection(value, selection);
  switch (range.type) {
    case SelectionType.Block: {
      let changedStartPara: { id: string } | undefined;
      const newValue = walkEditorValues(
        value,
        (subValue, _data, _blockId) => {
          if (subValue.id !== range.editorId) {
            return {
              stop: false,
              data: undefined,
            };
          }
          const startIndex = subValue.blocks.findIndex(
            (block) => block.id === range.start.blockId,
          );
          const endIndex = subValue.blocks.findIndex(
            (block) => block.id === range.end.blockId,
          );
          const newBlocks: BlockNode[] = [];
          for (let i = 0; i < subValue.blocks.length; i++) {
            const block = subValue.blocks[i];
            if (i < startIndex || i > endIndex) {
              newBlocks.push(block);
            }
            if (block.isBlock) {
              if (
                block.id === range.end.blockId &&
                range.start.type === BlockSelectionPointType.OtherBlock
              ) {
                let paraId = editorCtrl.makeId();
                newBlocks.push(
                  makeParagraph(
                    [makeText('', editorCtrl.textStyle, editorCtrl.makeId())],
                    editorCtrl.paragraphStyle,
                    paraId,
                  ),
                );
              }
              continue;
            }
            if (i > startIndex && i < endIndex) {
              continue;
            }
            if (i === startIndex) {
              if (startIndex === endIndex) {
                newBlocks.push(
                  removeTextFromParagraph(
                    block,
                    (range.start as ParagraphPoint).offset,
                    (range.end as ParagraphPoint).offset,
                  ),
                );
              } else {
                newBlocks.push(
                  removeTextFromParagraph(
                    block,
                    (range.start as ParagraphPoint).offset,
                    Infinity,
                  ),
                );
              }
            } else if (i === endIndex) {
              const endParagraph = removeTextFromParagraph(
                block,
                0,
                (range.end as ParagraphPoint).offset,
              );
              if (range.start.type === BlockSelectionPointType.Paragraph) {
                newBlocks[startIndex] = joinParagraphs(
                  newBlocks[startIndex] as ParagraphNode,
                  endParagraph,
                );
              } else {
                changedStartPara = { id: endParagraph.id };
                newBlocks.push(endParagraph);
              }
            }
          }
          if (range.start.type === BlockSelectionPointType.OtherBlock) {
            changedStartPara = { id: newBlocks[startIndex].id };
          }
          return {
            stop: true,
            data: undefined,
            newValue: makeEditorValue(newBlocks, subValue.id),
          };
        },
        undefined,
        true,
      ).mappedEditor;
      return {
        value: newValue,
        mapSelection(selection) {
          const containData = compareSelectionToBlockRange(
            value,
            selection,
            range,
          );
          let collapsedStart = range.start;
          if (changedStartPara) {
            collapsedStart = {
              type: BlockSelectionPointType.Paragraph,
              blockId: changedStartPara.id,
              offset: 0,
            };
          }
          if (containData.type === ContainType.Contained) {
            return {
              type: SelectionType.Block,
              editorId: range.editorId,
              start: collapsedStart,
              end: collapsedStart,
            };
          }
          if (containData.type === ContainType.SameLevel) {
            const { editor } = containData;
            const startBlockIndex = editor.blocks.findIndex(
              (block) => block.id === range.start.blockId,
            );
            const endBlockIndex = editor.blocks.findIndex(
              (block) => block.id === range.end.blockId,
            );
            if (selection.type !== SelectionType.Block) {
              throw new Error();
            }
            const orderedSelection = orderSelection(value, selection);
            const mapPoint = (
              point: BlockPoint | ParagraphPoint,
            ): BlockPoint | ParagraphPoint => {
              const blockIndex = editor.blocks.findIndex(
                (block) => block.id === point.blockId,
              );
              if (startBlockIndex <= blockIndex && blockIndex < endBlockIndex) {
                return collapsedStart;
              }
              if (blockIndex === endBlockIndex) {
                if (range.end.type === BlockSelectionPointType.OtherBlock) {
                  return collapsedStart;
                }
                if (
                  ((orderedSelection as BlockSelection).end as ParagraphPoint)
                    .offset <= range.end.offset
                ) {
                  return collapsedStart;
                }
                return {
                  type: BlockSelectionPointType.Paragraph,
                  blockId: range.end.blockId,
                  offset:
                    ((orderedSelection as BlockSelection).end as ParagraphPoint)
                      .offset - range.end.offset,
                };
              }
              return point;
            };
            return {
              type: SelectionType.Block,
              editorId: editor.id,
              start: mapPoint(selection.start),
              end: mapPoint(selection.end),
            };
          }
          return selection;
        },
      };
    }
    case SelectionType.Table: {
      const { mappedEditor: newValue, retValue: table } = walkEditorValues<
        TableNode | undefined
      >(
        value,
        (subValue, _data, _blockId) => {
          if (subValue.id !== range.editorId) {
            return {
              stop: false,
              data: undefined,
            };
          }
          let table: TableNode;
          const newBlocks = subValue.blocks.map((block) => {
            if (block.id === range.tableId) {
              table = block as TableNode;
              return makeTable(
                table.rows.map((row, rowIdx) =>
                  makeTableRow(
                    row.cells.map((cell, colIdx) => {
                      if (
                        ((range.startCell.rowIndex <= rowIdx &&
                          rowIdx <= range.endCell.rowIndex) ||
                          (range.endCell.rowIndex <= rowIdx &&
                            rowIdx <= range.startCell.rowIndex)) &&
                        ((range.startCell.columnIndex <= colIdx &&
                          colIdx <= range.endCell.columnIndex) ||
                          (range.endCell.columnIndex <= colIdx &&
                            colIdx <= range.startCell.columnIndex))
                      ) {
                        return makeTableCell(
                          makeEditorValue(
                            [
                              makeParagraph(
                                [
                                  makeText(
                                    '',
                                    editorCtrl.textStyle,
                                    editorCtrl.makeId(),
                                  ),
                                ],
                                editorCtrl.paragraphStyle,
                                editorCtrl.makeId(),
                              ),
                            ],
                            cell.value.id,
                          ),
                          cell.id,
                        );
                      } else {
                        return cell;
                      }
                    }),
                    row.id,
                  ),
                ),
                table.numColumns,
                table.id,
              );
            }
            return block;
          });
          if (!table!) {
            throw new Error();
          }
          return {
            stop: true,
            data: table,
            newValue: makeEditorValue(newBlocks, subValue.id),
          };
        },
        undefined,
        true,
      );
      return {
        value: newValue,
        mapSelection(selection) {
          console.log('sele', selection);
          // if (
          //   selection.type === SelectionType.Table &&
          //   selection.editorId === range.editorId &&
          //   selection.tableId === range.tableId
          // ) {
          //   return selection;
          // }
          // const res = walkEditorValues<string | undefined>(
          //   value,
          //   (subValue, cellId, ids) => {
          //     if (
          //       ids?.parentEditor.id === range.editorId &&
          //       ids.parentBlock.id === range.tableId
          //     ) {
          //       const table = ids.parentBlock as TableNode;
          //       const row = table.rows.find((row) =>
          //         row.cells.some((cell) => cell.value.id === subValue.id)
          //       ) as TableRow;
          //       const rowIndex = table.rows.indexOf(row);
          //       const cell = row.cells.find(
          //         (cell) => cell.value.id === subValue.id
          //       )!;
          //       const columnIndex = row.cells.indexOf(cell);
          //       if (
          //         range.startCell.rowIndex <= rowIndex &&
          //         rowIndex <= range.endCell.rowIndex &&
          //         range.startCell.columnIndex <= columnIndex &&
          //         columnIndex <= range.endCell.columnIndex
          //       ) {
          //         return {
          //           stop: subValue.id === selection.editorId,
          //           data: cell.id,
          //         };
          //       }
          //     }
          //     if (subValue.id === selection.editorId) {
          //       return {
          //         stop: true,
          //         data: cellId,
          //       };
          //     }
          //     return {
          //       stop: false,
          //       data: cellId,
          //     };
          //   },
          //   undefined,
          //   false
          // );
          // if (res.didStop && res.retValue !== undefined) {
          //   let paraId: string;
          //   if (!table) {
          //     throw new Error();
          //   }
          //   table.rows.forEach((row) => {
          //     row.cells.forEach((cell) => {
          //       if (cell.id === res.retValue) {
          //         paraId = cell.value.blocks[0].id;
          //       }
          //     });
          //   });
          //   if (!paraId!) {
          //     throw new Error();
          //   }
          //   const newPoint: ParagraphPoint = {
          //     type: BlockSelectionPointType.Paragraph,
          //     blockId: paraId,
          //     offset: 0,
          //   };
          //   return {
          //     type: SelectionType.Block,
          //     editorId: res.retValue,
          //     start: newPoint,
          //     end: newPoint,
          //   };
          // }
          return selection;
        },
      };
    }
  }
}

function getParagraphLength(paragraph: ParagraphNode): number {
  return paragraph.children.reduce(
    (len, node) => len + (node.isBlock ? 1 : node.text.length),
    0,
  );
}

function joinParagraphs(
  paragraphA: ParagraphNode,
  paragraphB: ParagraphNode,
): ParagraphNode {
  return fixParagraph(
    makeParagraph(
      paragraphA.children.concat(paragraphB.children),
      paragraphA.style,
      paragraphA.id,
    ),
  );
}

function insertSelection(
  editorCtrl: EditorController,
  selectionToInsert: Selection,
  newValue: EditorValue,
): {
  value: EditorValue;
  mapSelection: (selection: Selection, isCursor: boolean) => Selection;
} {
  const { value, mapSelection: mapSelectionFromRemove } = removeSelection(
    editorCtrl,
    selectionToInsert,
  );
  const selection = mapSelectionFromRemove(selectionToInsert, true);
  switch (selection.type) {
    case SelectionType.Block: {
      if (!isCollapsed(selection)) {
        throw new Error();
      }
      const point = selection.start;
      if (point.type !== BlockSelectionPointType.Paragraph) {
        console.log({ point });
        throw new Error();
      }
      let endPoint: ParagraphPoint | BlockPoint;
      const updated = walkEditorValues(
        value,
        (subValue, _data, _ids) => {
          if (subValue.id !== selection.editorId) {
            return {
              stop: false,
              data: undefined,
            };
          }
          const blockIndex = subValue.blocks.findIndex(
            (block) => block.id === point.blockId,
          );
          const block = subValue.blocks[blockIndex] as ParagraphNode;
          const firstBlock = newValue.blocks[0];
          const newBlocks = subValue.blocks.slice(0, blockIndex);
          if (firstBlock.isBlock) {
            if (point.offset > 0) {
              newBlocks.push(
                removeTextFromParagraph(block, point.offset, Infinity),
              );
            }
            newBlocks.push(firstBlock);
          } else {
            if (point.offset === 0) {
              newBlocks.push(
                makeParagraph(firstBlock.children, block.style, block.id),
              );
            } else {
              newBlocks.push(
                joinParagraphs(
                  removeTextFromParagraph(block, point.offset, Infinity),
                  firstBlock,
                ),
              );
            }
          }
          for (let i = 1; i < newValue.blocks.length; i++) {
            newBlocks.push(newValue.blocks[i]);
          }
          const lastBlock = newBlocks[newBlocks.length - 1];
          const blockLen = getParagraphLength(block);
          if (point.offset < blockLen) {
            const newPara = removeTextFromParagraph(block, 0, point.offset);
            const firstText = newPara.children[0] as TextNode;
            newPara.children[0] = makeText(
              firstText.text,
              firstText.style,
              editorCtrl.makeId(),
            );
            if (lastBlock.isBlock) {
              if (point.offset === 0) {
                newBlocks.push(newPara);
                endPoint = {
                  type: BlockSelectionPointType.Paragraph,
                  blockId: newPara.id,
                  offset: 0,
                };
              } else {
                let endPara = makeParagraph(
                  newPara.children,
                  newPara.style,
                  editorCtrl.makeId(),
                );
                endPoint = {
                  type: BlockSelectionPointType.Paragraph,
                  blockId: endPara.id,
                  offset: 0,
                };
                newBlocks.push(endPara);
              }
            } else {
              newBlocks[newBlocks.length - 1] = joinParagraphs(
                lastBlock,
                newPara,
              );
              endPoint = {
                type: BlockSelectionPointType.Paragraph,
                blockId: lastBlock.id,
                offset: getParagraphLength(lastBlock),
              };
            }
          } else {
            if (lastBlock.isBlock) {
              endPoint = {
                type: BlockSelectionPointType.OtherBlock,
                blockId: lastBlock.id,
              };
            } else {
              endPoint = {
                type: BlockSelectionPointType.Paragraph,
                blockId: lastBlock.id,
                offset: getParagraphLength(lastBlock),
              };
            }
          }
          for (let i = blockIndex + 1; i < subValue.blocks.length; i++) {
            newBlocks.push(subValue.blocks[i]);
          }
          return {
            stop: true,
            data: undefined,
            newValue: makeEditorValue(newBlocks, subValue.id),
          };
        },
        undefined,
        true,
      ).mappedEditor;
      return {
        value: updated,
        mapSelection(selection, isCursor) {
          const selectionAfterRemove = mapSelectionFromRemove(
            selection,
            isCursor,
          );
          const containData = compareSelectionToBlockRange(
            value,
            selectionAfterRemove,
            selection as BlockSelection,
          );
          if (containData.type === ContainType.Contained) {
            throw new Error();
          }
          if (containData.type === ContainType.SameLevel) {
            const { editor } = containData;
            if (selectionAfterRemove.type !== SelectionType.Block) {
              throw new Error();
            }
            const insertionPoint = selectionAfterRemove.start;
            const insertionBlockIndex = editor.blocks.findIndex(
              (block) => block.id === insertionPoint.blockId,
            );
            const mapPoint = (
              point: BlockPoint | ParagraphPoint,
            ): BlockPoint | ParagraphPoint => {
              const blockIndex = editor.blocks.findIndex(
                (block) => block.id === point.blockId,
              );
              if (blockIndex === insertionBlockIndex) {
                if (
                  insertionPoint.type !== BlockSelectionPointType.Paragraph ||
                  point.type !== BlockSelectionPointType.Paragraph
                ) {
                  throw new Error();
                }
                if (point.offset < insertionPoint.offset) {
                  return point;
                }
                return endPoint;
              }
              return point;
            };
            return {
              type: SelectionType.Block,
              editorId: editor.id,
              start: mapPoint(selectionAfterRemove.start),
              end: mapPoint(selectionAfterRemove.end),
            };
          }
          return selectionAfterRemove;
        },
      };
    }
    case SelectionType.Table: {
      const cellPoint = selection.endCell;
      const updated = walkEditorValues(
        value,
        (subValue, _data, ids) => {
          if (ids?.parentBlock.id !== selection.tableId) {
            return {
              stop: false,
              data: undefined,
            };
          }
          const table = ids.parentBlock as TableNode;
          const row = table.rows.find((row) =>
            row.cells.some((cell) => cell.value.id === subValue.id),
          )!;
          const rowIndex = table.rows.indexOf(row);
          const cell = row.cells.find((cell) => cell.value.id === subValue.id)!;
          const columnIndex = row.cells.indexOf(cell);
          if (
            rowIndex !== cellPoint.rowIndex ||
            columnIndex !== cellPoint.columnIndex
          ) {
            return {
              stop: false,
              data: undefined,
            };
          }
          return {
            stop: false,
            data: undefined,
            newValue,
          };
        },
        undefined,
        true,
      ).mappedEditor;
      return {
        value: updated,
        mapSelection(selection, isCursor) {
          const selectionAfterRemove = mapSelectionFromRemove(
            selection,
            isCursor,
          );
          if (!isCursor) {
            return selectionAfterRemove;
          }
          if (selection.type !== SelectionType.Table) {
            throw new Error();
          }
          if (
            selectionAfterRemove.type === SelectionType.Table &&
            selectionAfterRemove.editorId === selection.editorId &&
            selectionAfterRemove.tableId === selection.tableId &&
            selectionAfterRemove.startCell.rowIndex ===
              selection.startCell.rowIndex &&
            selectionAfterRemove.startCell.columnIndex ===
              selection.startCell.columnIndex &&
            selectionAfterRemove.endCell.rowIndex ===
              selection.endCell.rowIndex &&
            selectionAfterRemove.endCell.columnIndex ===
              selection.endCell.columnIndex
          ) {
            return walkEditorValues<Selection | undefined>(
              updated,
              (subValue, _data, ids) => {
                if (ids?.parentBlock.id !== selectionAfterRemove.tableId) {
                  return {
                    stop: false,
                    data: undefined,
                  };
                }
                const table = ids.parentEditor.blocks.find(
                  (block) => block.id === selectionAfterRemove.tableId,
                ) as TableNode;
                const row = table.rows.find((row) =>
                  row.cells.some((cell) => cell.value.id === subValue.id),
                )!;
                const rowIndex = table.rows.indexOf(row);
                const cell = row.cells.find(
                  (cell) => cell.value.id === subValue.id,
                )!;
                const columnIndex = row.cells.indexOf(cell);
                if (
                  rowIndex !== selectionAfterRemove.endCell.rowIndex ||
                  columnIndex !== selectionAfterRemove.endCell.columnIndex
                ) {
                  return {
                    stop: false,
                    data: undefined,
                  };
                }
                const lastBlock = subValue.blocks[subValue.blocks.length - 1];
                let point: ParagraphPoint | BlockPoint;
                if (lastBlock.isBlock) {
                  point = {
                    type: BlockSelectionPointType.OtherBlock,
                    blockId: lastBlock.id,
                  };
                } else {
                  point = {
                    type: BlockSelectionPointType.Paragraph,
                    blockId: lastBlock.id,
                    offset: getParagraphLength(lastBlock),
                  };
                }
                return {
                  stop: true,
                  data: fixSelection(updated, {
                    type: SelectionType.Block,
                    editorId: subValue.id,
                    start: point,
                    end: point,
                  }),
                };
              },
              undefined,
              false,
            ).retValue!;
          }
          return selectionAfterRemove;
        },
      };
    }
  }
}

function getTextNodeAndOffset(
  root: Element,
  offset: number,
): [node: Node, offset: number] {
  const iter = document.createNodeIterator(root, NodeFilter.SHOW_TEXT);
  let end = 0;
  let textNode: Node | null;
  let textNodes = [];
  while ((textNode = iter.nextNode())) {
    let start = end;
    end += textNode.textContent!.length;
    textNodes.push(textNode);
    if (offset === 0 || (start < offset && offset <= end)) {
      return [textNode, offset - start];
    }
  }
  console.log(
    end,
    root,
    textNodes.map((node) => node.textContent),
  );
  throw new Error();
}

interface TableCellPointWithBlockId extends TableCellPoint {
  tableId: string;
}

export function makeDOMBlockPoint(
  editorId: string,
  point: BlockPoint | ParagraphPoint | TableCellPointWithBlockId,
  direction: Direction.Forwards | Direction.Backwards,
  value: EditorValue,
  editableElement: HTMLElement,
): [node: Node, offset: number] {
  return walkEditorValues<[node: Node, offset: number] | undefined>(
    value,
    (subValue, _data, _ids) => {
      if (subValue.id !== editorId) {
        return {
          stop: false,
          data: undefined,
        };
      }
      if (
        'type' in point &&
        point.type === BlockSelectionPointType.OtherBlock
      ) {
        const node = editableElement.querySelector(
          `[data-id="${point.blockId}"]`,
        );
        if (!node) {
          console.log(value, point);
          throw new Error();
        }
        return {
          stop: true,
          data: [node, 0],
        };
      }
      if ('type' in point && point.type === BlockSelectionPointType.Paragraph) {
        console.log(point.blockId);
        const block = subValue.blocks.find(
          (block) => block.id === point.blockId,
        ) as ParagraphNode;
        if (!block) {
          console.log(value, editorId, subValue, point);
        }
        let end = 0;
        if (point.offset === 0) {
          if (
            block.children.length === 1 &&
            (block.children[0] as TextNode).text === ''
          ) {
            const node = editableElement.querySelector(
              `[data-id="${block.id}"]`,
            );
            if (!node) {
              throw new Error();
            }
            return {
              stop: true,
              data: [node, 0],
            };
          }
          console.log(block);
          const inlineNode = block.children[0];
          if (inlineNode.isBlock) {
            throw new Error();
          }
          const node = editableElement.querySelector(
            `[data-id="${inlineNode.id}"]`,
          );
          console.log({ node });
          if (!node) {
            throw new Error();
          }
          return {
            stop: true,
            data: getTextNodeAndOffset(node, 0),
          };
        }
        for (let i = 0; i < block.children.length; i++) {
          const inlineNode = block.children[i];
          let start = end;
          end += inlineNode.isBlock ? 1 : inlineNode.text.length;
          if (start < point.offset && point.offset <= end) {
            const node = editableElement.querySelector(
              `[data-id="${inlineNode.id}"]`,
            );
            if (!node) {
              throw new Error();
            }
            return {
              stop: true,
              data: getTextNodeAndOffset(node, point.offset - start),
            };
          }
        }
        throw new Error();
      }
      const table = subValue.blocks.find(
        (block) => block.id === point.tableId,
      ) as TableNode;
      const cell = table.rows[point.rowIndex].cells[point.columnIndex];
      const node = editableElement.querySelector(
        `[data-id="${cell.value.id}"]`,
      );
      if (!node) {
        throw new Error();
      }
      return {
        stop: true,
        data: [node, 0],
      };
    },
    undefined,
    false,
  ).retValue!;
}

function makeDOMRange(
  selection: Selection,
  value: EditorValue,
  editableElement: HTMLElement,
): Range {
  const direction = getDirection(value, selection);
  console.log('SELECTIONSLDN', { selection });
  if (selection.type === SelectionType.Block) {
    const start = makeDOMBlockPoint(
      selection.editorId,
      selection.start,
      direction === Direction.Forwards
        ? Direction.Backwards
        : Direction.Forwards,
      value,
      editableElement,
    );
    const end = isCollapsed(selection)
      ? start
      : makeDOMBlockPoint(
          selection.editorId,
          selection.end,
          direction === Direction.Forwards
            ? Direction.Forwards
            : Direction.Backwards,
          value,
          editableElement,
        );
    const domRange = window.document.createRange();
    console.log(selection, start, end);
    console.log(start[0].textContent);
    console.log(end[0].textContent);
    domRange.setStart(start[0], start[1]);
    domRange.setEnd(end[0], end[1]);
    return domRange;
  }
  const start = makeDOMBlockPoint(
    selection.editorId,
    { tableId: selection.tableId, ...selection.startCell },
    direction === Direction.Forwards ? Direction.Backwards : Direction.Forwards,
    value,
    editableElement,
  );
  const end = isCollapsed(selection)
    ? start
    : makeDOMBlockPoint(
        selection.editorId,
        { tableId: selection.tableId, ...selection.endCell },
        direction === Direction.Forwards
          ? Direction.Forwards
          : Direction.Backwards,
        value,
        editableElement,
      );
  const domRange = window.document.createRange();
  console.log(selection, start, end);
  domRange.setStart(start[0], start[1]);
  domRange.setEnd(end[0], end[1]);
  return domRange;
}

function extractSelection(
  value: EditorValue,
  selection: Selection,
): EditorValue {
  return walkEditorValues<EditorValue | undefined>(
    value,
    (subValue, _data, _ids) => {
      if (subValue.id !== selection.editorId) {
        return {
          stop: false,
          data: undefined,
        };
      }
      if (selection.type === SelectionType.Table) {
        const table = subValue.blocks.find(
          (block) => block.id === selection.tableId,
        ) as TableNode;
        return {
          stop: true,
          data: makeEditorValue(
            [
              makeTable(
                table.rows
                  .slice(
                    Math.min(
                      selection.startCell.rowIndex,
                      selection.endCell.rowIndex,
                    ),
                    Math.max(
                      selection.startCell.rowIndex,
                      selection.endCell.rowIndex,
                    ) + 1,
                  )
                  .map((row) =>
                    makeTableRow(
                      row.cells.slice(
                        Math.min(
                          selection.startCell.columnIndex,
                          selection.endCell.columnIndex,
                        ),
                        Math.max(
                          selection.startCell.columnIndex,
                          selection.endCell.columnIndex,
                        ) + 1,
                      ),
                      row.id,
                    ),
                  ),
                table.numColumns,
                table.id,
              ),
            ],
            subValue.id,
          ),
        };
      }
      const startIndex = subValue.blocks.findIndex(
        (block) => block.id === selection.start.blockId,
      );
      const startBlock = subValue.blocks[startIndex];
      const endIndex = subValue.blocks.findIndex(
        (block) => block.id === selection.end.blockId,
      );
      const endBlock = subValue.blocks[endIndex];
      const newBlocks = [];
      if (selection.start.type === BlockSelectionPointType.OtherBlock) {
        newBlocks.push(startBlock);
      } else {
        if (startIndex === endIndex) {
          newBlocks.push(
            removeTextFromParagraph(
              removeTextFromParagraph(
                startBlock as ParagraphNode,
                0,
                selection.start.offset,
              ),
              (selection.end as ParagraphPoint).offset,
              Infinity,
            ),
          );
        } else {
          newBlocks.push(
            removeTextFromParagraph(
              startBlock as ParagraphNode,
              0,
              selection.start.offset,
            ),
          );
        }
      }
      for (let i = startIndex + 1; i < endIndex; i++) {
        newBlocks.push(value.blocks[i]);
      }
      if (startIndex !== endIndex) {
        if (endBlock.isBlock) {
          newBlocks.push(endBlock);
        } else {
          newBlocks.push(
            removeTextFromParagraph(
              endBlock,
              (selection.end as ParagraphPoint).offset,
              Infinity,
            ),
          );
        }
      }
      return {
        stop: true,
        data: makeEditorValue(newBlocks, subValue.id),
      };
    },
    undefined,
    false,
  ).retValue!;
}

enum DataTransferType {
  Plain,
  Rich,
}
interface PlainDataTransfer {
  type: DataTransferType.Plain;
  text: string;
}
interface RichDataTransfer {
  type: DataTransferType.Rich;
  value: EditorValue;
}
type EditorDataTransfer = PlainDataTransfer | RichDataTransfer;

const SelectedEditorsContext = createContext<string[]>([]);

export function ReactEditor({
  initialValue,
  makeId,
}: {
  initialValue: EditorValue;
  makeId: () => string;
}): JSX.Element {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const editorCtrl = useRef<EditorController>({
    value: initialValue,
    selection: null,
    textStyle: { flags: 0 },
    paragraphStyle: { type: ParagraphStyleType.Default },
    makeId,
  });
  const isUpdatingSelection = useRef<boolean>(false);
  const inputQueueRef = useRef<
    { inputType: string; selection: Selection; data?: EditorDataTransfer }[]
  >([]);
  const inputQueueRequestRef = useRef<number | null>(null);
  const [_domSelectionToggle, setDomSelectionToggle] = useState(false);
  const [newDomSelection, setDomSelection] = useState<{
    v: Selection;
  } | null>(null);
  const [_renderToggle, setRenderToggle] = useState(false);

  const updateSelection = (newSelection: Selection): void => {
    if (isUpdatingSelection.current) {
      return;
    }

    editorRef.current!.focus();

    const native = window.getSelection()!;

    const { rangeCount } = native;

    const current = !!rangeCount && native.getRangeAt(0);
    const range = makeDOMRange(
      newSelection,
      editorCtrl.current.value,
      editorRef.current!,
    );

    const { startContainer, startOffset, endContainer, endOffset } = range;

    console.log('MAKE SEL', newSelection, startContainer);

    if (
      current &&
      ((startContainer === current.startContainer &&
        startOffset === current.startOffset &&
        endContainer === current.endContainer &&
        endOffset === current.endOffset) ||
        (startContainer === current.endContainer &&
          startOffset === current.endOffset &&
          endContainer === current.startContainer &&
          endOffset === current.startOffset))
    ) {
      return;
    }

    isUpdatingSelection.current = true;
    if (native.rangeCount !== 1) {
      native.removeAllRanges();
      if (
        getDirection(editorCtrl.current.value, newSelection) ===
        Direction.Backwards
      ) {
        native.setBaseAndExtent(
          range.endContainer,
          range.endOffset,
          range.startContainer,
          range.startOffset,
        );
      } else {
        native.setBaseAndExtent(
          range.startContainer,
          range.startOffset,
          range.endContainer,
          range.endOffset,
        );
      }
    } else {
      const nativeRange = native.getRangeAt(0);
      if (
        getDirection(editorCtrl.current.value, newSelection) ===
        Direction.Backwards
      ) {
        nativeRange.setStart(range.endContainer, range.endOffset);
        nativeRange.setEnd(range.startContainer, range.startOffset);
      } else {
        nativeRange.setStart(range.startContainer, range.startOffset);
        nativeRange.setEnd(range.endContainer, range.endOffset);
      }
    }
    setTimeout(() => {
      isUpdatingSelection.current = false;
    });
  };

  const flushInputQueue = (): void => {
    inputQueueRequestRef.current = null;
    console.log(inputQueueRef.current);
    let mapSelectionFns: ((
      selection: Selection,
      isCursor: boolean,
    ) => Selection)[] = [];
    const queue = inputQueueRef.current;
    inputQueueRef.current = [];
    let newValue = editorCtrl.current.value;
    let newSelection = editorCtrl.current.selection;
    queue.forEach(({ inputType, selection: originalSelection, data }) => {
      const inputSelection = mapSelectionFns.reduce(
        (selection, mapSelection) => mapSelection(selection, true),
        originalSelection,
      );
      switch (inputType) {
        case 'deleteByDrag':
        case 'deleteByCut':
        case 'deleteContent':
        case 'deleteContentBackward':
        case 'deleteContentForward':
        case 'deleteWordBackward':
        case 'deleteWordForward':
        case 'deleteSoftLineBackward':
        case 'deleteHardLineBackward':
        case 'deleteSoftLineForward':
        case 'deleteHardLineForward': {
          const edit = removeSelection(
            {
              value: newValue,
              selection: newSelection,
              textStyle: editorCtrl.current.textStyle,
              paragraphStyle: editorCtrl.current.paragraphStyle,
              makeId,
            },
            inputSelection,
          );
          newValue = edit.value;
          newSelection = edit.mapSelection(inputSelection, true);
          mapSelectionFns.push(edit.mapSelection);
          break;
        }
        case 'insertLineBreak':
        case 'insertFromYank':
        case 'insertReplacementText':
        case 'insertText':
        case 'insertFromPaste':
        case 'insertFromDrop': {
          if (!data) {
            return;
          }
          console.log({ data });
          const insertValue =
            data.type === DataTransferType.Rich
              ? data.value
              : makeEditorValue(
                  [
                    makeParagraph(
                      [
                        makeText(
                          data.text,
                          editorCtrl.current.textStyle,
                          makeId(),
                        ),
                      ],
                      editorCtrl.current.paragraphStyle,
                      makeId(),
                    ),
                  ],
                  makeId(),
                );
          const edit = insertSelection(
            {
              value: newValue,
              selection: newSelection,
              textStyle: editorCtrl.current.textStyle,
              paragraphStyle: editorCtrl.current.paragraphStyle,
              makeId,
            },
            inputSelection,
            insertValue,
          );
          newValue = edit.value;
          newSelection = edit.mapSelection(inputSelection, true);
          mapSelectionFns.push(edit.mapSelection);
          break;
        }
        case 'insertParagraph': {
          const insertValue = makeEditorValue(
            [
              makeParagraph(
                [makeText('', editorCtrl.current.textStyle, makeId())],
                editorCtrl.current.paragraphStyle,
                makeId(),
              ),
              makeParagraph(
                [makeText('', editorCtrl.current.textStyle, makeId())],
                editorCtrl.current.paragraphStyle,
                makeId(),
              ),
            ],
            makeId(),
          );
          const edit = insertSelection(
            {
              value: newValue,
              selection: newSelection,
              textStyle: editorCtrl.current.textStyle,
              paragraphStyle: editorCtrl.current.paragraphStyle,
              makeId,
            },
            inputSelection,
            insertValue,
          );
          newValue = edit.value;
          newSelection = edit.mapSelection(inputSelection, true);
          mapSelectionFns.push(edit.mapSelection);
          break;
        }
      }
    });
    editorCtrl.current.value = newValue;
    editorCtrl.current.selection = newSelection;
    setRenderToggle((t) => !t);
    console.log('NEW SEL', newSelection);
    setDomSelection(newSelection && { v: newSelection });
    console.log(newValue, newSelection!);
  };

  useLayoutEffect(() => {
    if (newDomSelection) {
      console.log('newsel', newDomSelection.v, editorCtrl.current.value);
      updateSelection(newDomSelection.v);
    }
  }, [newDomSelection]);

  function isSelectionBackwards(selection: globalThis.Selection): boolean {
    let position = selection.anchorNode!.compareDocumentPosition(
      selection.focusNode!,
    );
    return (
      (!position && selection.anchorOffset > selection.focusOffset) ||
      position === Node.DOCUMENT_POSITION_PRECEDING
    );
  }

  const onBeforeInput = (event: InputEvent): void => {
    event.preventDefault();
    const [targetRange] = event.getTargetRanges();
    const curNativeSelection = window.getSelection();
    let isBackwards = false;
    if (curNativeSelection) {
      const curNativeRange = curNativeSelection.getRangeAt(0);
      console.log('native');
      if (
        curNativeRange.startContainer === targetRange.startContainer &&
        curNativeRange.endContainer === targetRange.endContainer &&
        curNativeRange.startOffset === targetRange.startOffset &&
        curNativeRange.endOffset === targetRange.endOffset
      ) {
        isBackwards = isSelectionBackwards(curNativeSelection);
      }
    }
    let selection: Selection;
    try {
      selection = findSelection(
        editorCtrl.current.value,
        targetRange,
        isBackwards,
      );
    } catch (error) {
      console.error(error);
      return;
    }
    let data: EditorDataTransfer | undefined;
    function mapValue(value: EditorValue): EditorValue {
      return makeEditorValue(
        value.blocks.map((block) => {
          if (block.isBlock) {
            if (block.type === BlockNodeType.Table) {
              return makeTable(
                block.rows.map((row) =>
                  makeTableRow(
                    row.cells.map((cell) =>
                      makeTableCell(mapValue(cell.value), makeId()),
                    ),
                    makeId(),
                  ),
                ),
                block.numColumns,
                makeId(),
              );
            }
            return { ...block, id: makeId() };
          }
          return makeParagraph(
            block.children.map((child) => ({ ...child, id: makeId() })),
            block.style,
            makeId(),
          );
        }),
        makeId(),
      );
    }
    if (event.dataTransfer) {
      const rich = event.dataTransfer.getData('text/x-matita');
      if (rich) {
        data = {
          type: DataTransferType.Rich,
          value: mapValue(JSON.parse(rich) as EditorValue),
        };
      } else {
        const plain = event.dataTransfer.getData('text/plain');
        if (plain) {
          data = {
            type: DataTransferType.Plain,
            text: plain,
          };
        }
      }
    } else if (event.data) {
      data = {
        type: DataTransferType.Plain,
        text: event.data,
      };
    }
    console.log('requesting', JSON.stringify(inputQueueRef.current));
    if (inputQueueRef.current.length === 0) {
      inputQueueRequestRef.current = requestAnimationFrame(flushInputQueue);
    }
    inputQueueRef.current.push({
      inputType: event.inputType,
      selection,
      data,
    });
  };

  useEffect(() => {
    return () => {
      if (inputQueueRequestRef.current !== null) {
        cancelAnimationFrame(inputQueueRequestRef.current);
      }
    };
  }, []);

  const stringifiedSelection = JSON.stringify(editorCtrl.current.selection);
  const onHTMLSelectionChange = (event: Event): void => {
    if (isUpdatingSelection.current) {
      return;
    }

    const { activeElement } = window.document;

    if (activeElement !== editorRef.current) {
      return;
    }

    const nativeSelection = window.getSelection()!;
    const curSelection = findSelection(
      editorCtrl.current.value,
      nativeSelection.getRangeAt(0),
      isSelectionBackwards(nativeSelection),
    );

    if (JSON.stringify(curSelection) !== stringifiedSelection) {
      editorCtrl.current.selection = curSelection;
      setRenderToggle((t) => !t);
    }
  };

  const onCopy = (event: ClipboardEvent): void => {
    const nativeSelection = window.getSelection();
    if (!nativeSelection) {
      return;
    }
    const curSelection = findSelection(
      editorCtrl.current.value,
      nativeSelection.getRangeAt(0),
      isSelectionBackwards(nativeSelection),
    );
    const curValue = extractSelection(editorCtrl.current.value, curSelection);
    event.clipboardData!.setData('text/x-matita', JSON.stringify(curValue));
    event.preventDefault();
  };

  useEffect(() => {
    const editorElement = editorRef.current!;
    window.document.addEventListener('selectionchange', onHTMLSelectionChange);
    editorElement.addEventListener('beforeinput', onBeforeInput);
    editorElement.addEventListener('copy', onCopy);
    return () => {
      window.document.removeEventListener(
        'selectionchange',
        onHTMLSelectionChange,
      );
      editorElement.removeEventListener('beforeinput', onBeforeInput);
      editorElement.removeEventListener('copy', onCopy);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedEditors = ((): string[] => {
    const { selection } = editorCtrl.current;
    if (!selection) {
      return [];
    }
    const selected: string[] = [];
    walkEditorValues(
      editorCtrl.current.value,
      (subValue, isSelected, ids) => {
        if (isSelected) {
          selected.push(subValue.id);
          return {
            stop: false,
            data: isSelected,
          };
        }
        if (
          selection.type === SelectionType.Table &&
          ids?.parentEditor.id === selection.editorId &&
          ids.parentBlock.id === selection.tableId
        ) {
          const table = ids.parentBlock as TableNode;
          const row = table.rows.find((row) =>
            row.cells.some((cell) => cell.value.id === subValue.id),
          )!;
          const rowIndex = table.rows.indexOf(row);
          const cell = row.cells.find((cell) => cell.value.id === subValue.id)!;
          const columnIndex = row.cells.indexOf(cell);
          if (
            ((selection.startCell.rowIndex <= rowIndex &&
              rowIndex <= selection.endCell.rowIndex) ||
              (selection.endCell.rowIndex <= rowIndex &&
                rowIndex <= selection.startCell.rowIndex)) &&
            ((selection.startCell.columnIndex <= columnIndex &&
              columnIndex <= selection.endCell.columnIndex) ||
              (selection.endCell.columnIndex <= columnIndex &&
                columnIndex <= selection.startCell.columnIndex))
          ) {
            selected.push(cell.value.id);
            return {
              stop: false,
              data: true,
            };
          }
        }
        if (
          selection.type === SelectionType.Block &&
          ids?.parentEditor.id === selection.editorId
        ) {
          const startBlockIndex = ids.parentEditor.blocks.findIndex(
            (block) => block.id === selection.start.blockId,
          );
          const parentBlockIndex = ids.parentEditor.blocks.findIndex(
            (block) => block.id === ids.parentBlock.id,
          );
          const endBlockIndex = ids.parentEditor.blocks.findIndex(
            (block) => block.id === selection.end.blockId,
          );
          if (
            (startBlockIndex <= parentBlockIndex &&
              parentBlockIndex <= endBlockIndex) ||
            (endBlockIndex <= parentBlockIndex &&
              parentBlockIndex <= startBlockIndex)
          ) {
            selected.push(subValue.id);
            return {
              stop: false,
              data: true,
            };
          }
        }
        return {
          stop: false,
          data: false,
        };
      },
      false,
      false,
    );
    return selected;
  })();

  const [isClient, setIsClient] = useState(false);
  useEffect(() => {
    setIsClient(true);
  }, [isClient]);

  return (
    <div
      contentEditable={isClient}
      suppressContentEditableWarning
      ref={editorRef}
    >
      <SelectedEditorsContext.Provider value={selectedEditors}>
        <ReactEditorValue value={editorCtrl.current.value} />
      </SelectedEditorsContext.Provider>
    </div>
  );
}
