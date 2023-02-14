'use client';
import React, {
  cloneElement,
  createContext,
  memo,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Image from 'next/image';
import { Roboto } from '@next/font/google';
import { Tooltip } from '@/Tooltip';
import { createDraft, finishDraft } from 'immer';
import { WritableDraft } from 'immer/dist/internal';

const roboto = Roboto({
  weight: ['400', '700'],
  style: ['normal', 'italic'],
  subsets: ['latin'],
});

enum EditorFamilyType {
  Editor = 'Editor',
  Block = 'Block',
  Inline = 'Inline',
}

enum BlockNodeType {
  Table = 'Block/Table',
  Image = 'Block/Image',
  Paragraph = 'Block/Paragraph',
}

enum InlineNodeType {
  Text = 'Inline/Text',
  Mention = 'Inline/Mention',
}

enum SelectionType {
  Table = 'Table',
  Block = 'Block',
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
  OtherBlock = 'OtherBlock',
  Paragraph = 'Paragraph',
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

enum ParagraphStyleType {
  Default = 'Default',
  Subtitle = 'Heading',
  Title = 'Title',
  Quote = 'Quote',
  PullQuote = 'PullQuote',
  BulletList = 'BulletList',
  NumberedList = 'NumberedList',
}

interface DefaultParagraphStyle {
  type: ParagraphStyleType.Default;
}
interface HeadingParagraphStyle {
  type: ParagraphStyleType.Subtitle;
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

enum TextScript {
  Superscript = 'Superscript',
  Subscript = 'Subscript',
}

interface TextStyle {
  bold?: true;
  italic?: true;
  underline?: true;
  code?: true;
  strikethrough?: true;
  script?: TextScript;
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

enum PushStateAction {
  Unique,
  Insert,
  Delete,
  Selection,
}

interface EditorController {
  value: EditorValue;
  textStyle: TextStyle;
  selection: Selection | null;
  undos: EditorController[];
  redos: EditorController[];
  lastAction: PushStateAction;
  makeId(): string;
}

interface EditorValue {
  blocks: BlockNode[];
  id: string;
}

function makeParagraph(
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

function makeDefaultParagraph(
  children: InlineNode[],
  id: string,
): ParagraphNode {
  return makeParagraph(children, { type: ParagraphStyleType.Default }, id);
}
function makeHeadingParagraph(
  children: InlineNode[],
  id: string,
): ParagraphNode {
  return makeParagraph(children, { type: ParagraphStyleType.Subtitle }, id);
}
function makeTitleParagraph(children: InlineNode[], id: string): ParagraphNode {
  return makeParagraph(children, { type: ParagraphStyleType.Title }, id);
}
function makeQuoteParagraph(children: InlineNode[], id: string): ParagraphNode {
  return makeParagraph(children, { type: ParagraphStyleType.Quote }, id);
}
function makePullQuoteParagraph(
  children: InlineNode[],
  id: string,
): ParagraphNode {
  return makeParagraph(children, { type: ParagraphStyleType.PullQuote }, id);
}
function makeBulletListParagraph(
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
function makeNumberedListParagraph(
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

function makeTable(
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

function makeTableRow(cells: TableCell[], id: string): TableRow {
  return {
    cells,
    id,
  };
}

function makeTableCell(value: EditorValue, id: string): TableCell {
  return {
    value,
    id,
  };
}

function makeImage(src: string, caption: string, id: string): ImageNode {
  return {
    type: BlockNodeType.Image,
    isBlock: true,
    src,
    caption,
    id,
  };
}

function makeText(text: string, style: TextStyle, id: string): TextNode {
  return {
    type: InlineNodeType.Text,
    isBlock: false,
    text,
    style,
    id,
  };
}

function makeMention(text: string, username: string, id: string): MentionNode {
  return {
    type: InlineNodeType.Mention,
    isBlock: true,
    username,
    id,
  };
}

function makeDefaultText(text: string, id: string): TextNode {
  return makeText(text, {}, id);
}

function makeEditorValue(blocks: BlockNode[], id: string): EditorValue {
  return {
    blocks,
    id,
  };
}

interface ReactTableNodeProps {
  value: TableNode;
}
function ReactTableNode_({
  value,
  selectedCells,
}: ReactTableNodeProps & { selectedCells: string[] }): JSX.Element {
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
                        selectedCells.includes(cell.value.id)
                          ? 'selected'
                          : selectedCells.length > 0
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
const ReactTableNode_m = memo(ReactTableNode_, (a, b) => {
  return (
    a.value === b.value &&
    a.selectedCells.length === b.selectedCells.length &&
    a.selectedCells.every((id, i) => b.selectedCells[i] === id)
  );
});
function ReactTableNode({ value }: ReactTableNodeProps): JSX.Element {
  const selectedEditors = useContext(SelectedEditorsContext);
  const selectedCells = useMemo(() => {
    let selectedCells: string[] = [];
    value.rows.forEach((row) => {
      row.cells.forEach((cell) => {
        if (selectedEditors.includes(cell.value.id)) {
          selectedCells.push(cell.value.id);
        }
      });
    });
    return selectedCells;
  }, [value, selectedEditors]);
  if (selectedEditors.length !== 0) {
  }
  return <ReactTableNode_m value={value} selectedCells={selectedCells} />;
}

function ReactBlockImageNode_({ value }: { value: ImageNode }): JSX.Element {
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
const ReactBlockImageNode = memo(ReactBlockImageNode_);

function ReactParagraphNode_(
  props:
    | {
        value: ParagraphNode & {
          style: Exclude<ParagraphStyle, NumberedListParagraphStyle>;
        };
      }
    | {
        value: ParagraphNode & {
          style: NumberedListParagraphStyle;
        };
        listIndex: number;
      },
): JSX.Element {
  const { value } = props;
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
    case ParagraphStyleType.Subtitle: {
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
          className="pullquote"
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
const ReactParagraphNode = memo(ReactParagraphNode_);

function ReactTextNode({ value }: { value: TextNode }): JSX.Element {
  let text: JSX.Element | string = value.text;
  if (value.style.bold) {
    text = <b>{text}</b>;
  }
  if (value.style.italic) {
    text = <i>{text}</i>;
  }
  if (value.style.underline) {
    text = <u>{text}</u>;
  }
  if (value.style.code) {
    text = <code>{text}</code>;
  }
  if (value.style.strikethrough) {
    text = <del>{text}</del>;
  }
  if (value.style.script === TextScript.Superscript) {
    text = <sup>{text}</sup>;
  }
  if (value.style.script === TextScript.Subscript) {
    text = <sub>{text}</sub>;
  }
  if (typeof text !== 'string') {
    return cloneElement(text, {
      className: 'inline-text',
      'data-family': EditorFamilyType.Inline,
      'data-type': InlineNodeType.Text,
      'data-id': value.id,
    });
  }
  return (
    <span
      className="inline-text"
      data-family={EditorFamilyType.Inline}
      data-type={InlineNodeType.Text}
      data-id={value.id}
    >
      {text}
    </span>
  );
}

function groupArr<T, G>(
  items: T[],
  getGroup: (item: T) => G,
  cmpGroups: (a: G, b: G) => boolean,
): { groupInfo: G; items: T[] }[] {
  let groups: { groupInfo: G; items: T[] }[] = [];
  let lastGroup: G;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const group = getGroup(item);
    if (i === 0 || !cmpGroups(lastGroup!, group)) {
      groups.push({ groupInfo: group, items: [item] });
    } else {
      groups[groups.length - 1].items.push(item);
    }
    lastGroup = group;
  }
  return groups;
}

interface ReactEditorValueProps {
  value: EditorValue;
}
function ReactEditorValue_({
  value,
  listBlockIdToIdx,
}: ReactEditorValueProps & {
  listBlockIdToIdx: Record<string, number>;
}): JSX.Element {
  let children: JSX.Element[] = [];
  groupArr(
    value.blocks,
    (block) => {
      if (
        block.type === BlockNodeType.Paragraph &&
        (block.style.type === ParagraphStyleType.BulletList ||
          block.style.type === ParagraphStyleType.NumberedList)
      ) {
        return { listType: block.style.type, listId: block.style.listId };
      }
      return null;
    },
    (a, b) => a === b || (a !== null && b !== null && a.listId === b.listId),
  ).forEach((group) => {
    const { groupInfo } = group;
    if (groupInfo !== null) {
      const { listId, listType } = groupInfo;
      const items = group.items as (ParagraphNode & {
        style: BulletListParagraphStyle | NumberedListParagraphStyle;
      })[];
      const listNodes = items.map((block) => {
        if (block.style.type === ParagraphStyleType.NumberedList) {
          return (
            <ReactParagraphNode
              value={
                block as ParagraphNode & {
                  style: NumberedListParagraphStyle;
                }
              }
              listIndex={listBlockIdToIdx[block.id]}
              key={block.id}
            />
          );
        }
        return (
          <ReactParagraphNode
            value={
              block as ParagraphNode & {
                style: BulletListParagraphStyle;
              }
            }
            key={block.id}
          />
        );
      });
      if (listType === ParagraphStyleType.NumberedList) {
        children.push(
          <ol key={items[0].id} start={listBlockIdToIdx[items[0].id] + 1}>
            {listNodes}
          </ol>,
        );
      } else {
        children.push(<ul key={items[0].id}>{listNodes}</ul>);
      }
      return;
    }
    group.items.forEach((block) => {
      switch (block.type) {
        case BlockNodeType.Image: {
          children.push(<ReactBlockImageNode value={block} key={block.id} />);
          break;
        }
        case BlockNodeType.Table: {
          children.push(<ReactTableNode value={block} key={block.id} />);
          break;
        }
        case BlockNodeType.Paragraph: {
          children.push(
            <ReactParagraphNode
              value={
                block as ParagraphNode & {
                  style: Exclude<ParagraphStyle, NumberedListParagraphStyle>;
                }
              }
              key={block.id}
            />,
          );
          break;
        }
      }
    });
  });
  return (
    <div data-family={EditorFamilyType.Editor} data-id={value.id}>
      {children}
    </div>
  );
}
const ReactEditorValue_m = memo(ReactEditorValue_);
function ReactEditorValue({ value }: ReactEditorValueProps): JSX.Element {
  const listBlockIdToIdx = useContext(NumberedListIndicesContext);
  return (
    <ReactEditorValue_m value={value} listBlockIdToIdx={listBlockIdToIdx} />
  );
}

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

type Selection = BlockSelection | TableSelection;

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
    ids: {
      parentEditor: EditorValue;
      parentBlock: Extract<BlockNode, { isBlock: true }>;
    } | null,
  ) => { data: T; newValue?: EditorValue; stop: boolean; stopCur?: boolean },
  initialData: T,
  willMap: boolean,
  onBlock?: (block: BlockNode) => void,
): { didStop: boolean; retValue: T; mappedEditor: EditorValue } {
  let didStop = false;
  let retValue: T = initialData;
  function walk(
    value: WritableDraft<EditorValue> | EditorValue,
    data: T,
  ): void {
    for (let bI = 0; bI < value.blocks.length && !didStop; bI++) {
      const block = value.blocks[bI];
      onBlock?.(block);
      if (block.type === BlockNodeType.Table) {
        for (let i = 0; i < block.rows.length && !didStop; i++) {
          let row = block.rows[i];
          for (let j = 0; j < row.cells.length && !didStop; j++) {
            let cell = row.cells[j];
            const {
              data: newData,
              newValue,
              stop,
              stopCur,
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
            } else if (!stopCur) {
              walk(newValue || cell.value, newData);
            }
          }
        }
      }
    }
  }
  let { data, newValue, stop } = onEditorValue(editor, initialData, null);
  let value: WritableDraft<EditorValue> | EditorValue = editor;
  if (newValue) {
    if (!willMap) {
      throw new Error();
    }
    if (stop) {
      return { didStop: false, retValue: data, mappedEditor: newValue };
    } else {
      value = createDraft(newValue);
    }
  } else if (willMap) {
    value = createDraft(editor);
  }
  if (stop) {
    return { didStop: true, retValue: data, mappedEditor: editor };
  }
  walk(value, data);
  return {
    didStop,
    retValue,
    mappedEditor: willMap ? finishDraft(value) : value,
  };
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

function isTextStyleSame(a: TextStyle, b: TextStyle): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.code === b.code &&
    a.strikethrough === b.strikethrough &&
    a.script === b.script
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
  let children = paragraph.children;
  if (children.some((child) => !child.isBlock && child.text === '')) {
    children = children.filter((child) => child.isBlock || child.text !== '');
  }
  let newChildren = [children[0]];
  for (let i = 1; i < children.length; i++) {
    const prev = newChildren[newChildren.length - 1];
    const cur = children[i];
    if (prev.isBlock || cur.isBlock) {
      newChildren.push(cur);
      continue;
    }
    if (isTextStyleSame(prev.style, cur.style)) {
      newChildren[newChildren.length - 1] = makeText(
        prev.text + cur.text,
        prev.style,
        prev.id,
      );
    } else {
      newChildren.push(cur);
    }
  }
  return makeParagraph(newChildren, paragraph.style, paragraph.id);
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
                  makeDefaultParagraph(
                    [makeText('', editorCtrl.textStyle, editorCtrl.makeId())],
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
              if (blockIndex === startBlockIndex) {
                if (
                  range.start.type === BlockSelectionPointType.Paragraph &&
                  (point as ParagraphPoint).offset < range.start.offset
                ) {
                  return point;
                }
                if (startBlockIndex !== endBlockIndex) {
                  return collapsedStart;
                }
              }
              if (startBlockIndex < blockIndex && blockIndex < endBlockIndex) {
                return collapsedStart;
              }
              if (blockIndex === endBlockIndex) {
                if (range.end.type === BlockSelectionPointType.OtherBlock) {
                  return collapsedStart;
                }
                if ((point as ParagraphPoint).offset <= range.end.offset) {
                  return collapsedStart;
                }
                return {
                  type: BlockSelectionPointType.Paragraph,
                  blockId: range.end.blockId,
                  offset:
                    ((orderedSelection as BlockSelection).end as ParagraphPoint)
                      .offset -
                    (startBlockIndex === endBlockIndex
                      ? range.end.offset -
                        (range.start as ParagraphPoint).offset
                      : range.end.offset),
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
      let newTable: TableNode;
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
              newTable = makeTable(
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
                              makeDefaultParagraph(
                                [
                                  makeText(
                                    '',
                                    editorCtrl.textStyle,
                                    editorCtrl.makeId(),
                                  ),
                                ],
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
              return newTable;
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
          if (
            selection.type === SelectionType.Table &&
            selection.tableId === range.tableId
          ) {
            return selection;
          }
          const cellPoint = walkEditorValues<TableCellPoint | undefined>(
            value,
            (subValue, cellPoint, ids) => {
              if (ids?.parentBlock.id === range.tableId) {
                const table = ids.parentBlock as TableNode;
                const row = table.rows.find((row) =>
                  row.cells.some((cell) => cell.value.id === subValue.id),
                )!;
                const rowIndex = table.rows.indexOf(row);
                const cell = row.cells.find(
                  (cell) => cell.value.id === subValue.id,
                )!;
                const columnIndex = row.cells.indexOf(cell);
                if (
                  ((range.startCell.rowIndex <= rowIndex &&
                    rowIndex <= range.endCell.rowIndex) ||
                    (range.endCell.rowIndex <= rowIndex &&
                      rowIndex <= range.startCell.rowIndex)) &&
                  ((range.startCell.columnIndex <= columnIndex &&
                    columnIndex <= range.endCell.columnIndex) ||
                    (range.endCell.columnIndex <= columnIndex &&
                      columnIndex <= range.startCell.columnIndex))
                ) {
                  return {
                    stop: subValue.id === selection.editorId,
                    data: {
                      rowIndex,
                      columnIndex,
                    },
                  };
                }
                return {
                  stop: true,
                  data: undefined,
                };
              }
              if (
                (selection.type === SelectionType.Table &&
                  ids?.parentBlock.id === selection.tableId) ||
                subValue.id === selection.editorId
              ) {
                return {
                  stop: true,
                  data: cellPoint,
                };
              }
              return {
                stop: false,
                data: cellPoint,
              };
            },
            undefined,
            false,
          ).retValue;
          if (!cellPoint) {
            return selection;
          }
          const cell =
            newTable!.rows[cellPoint.rowIndex].cells[cellPoint.columnIndex];
          const point: ParagraphPoint = {
            type: BlockSelectionPointType.Paragraph,
            blockId: (cell.value.blocks[0] as ParagraphNode).id,
            offset: 0,
          };
          return {
            type: SelectionType.Block,
            editorId: cell.value.id,
            start: point,
            end: point,
          };
        },
      };
    }
  }
}

function mapNodes(
  editorCtrl: EditorController,
  selection: Selection,
  //   mapNonParagraphBlock: (
  //     block: Extract<BlockNode, { isBlock: true }>,
  //   ) => Extract<BlockNode, { isBlock: true }>,
  mapNonTextInline: (
    block: Extract<InlineNode, { isBlock: true }>,
  ) => Extract<InlineNode, { isBlock: true }>,
  mapParagraphSyle: (style: ParagraphStyle) => ParagraphStyle,
  mapTextStyle: (style: TextStyle) => TextStyle,
): {
  value: EditorValue;
  mapSelection: (selection: Selection, isCursor: boolean) => Selection;
} {
  if (isCollapsed(selection)) {
    return {
      value: editorCtrl.value,
      mapSelection(selection, _isCursor) {
        return selection;
      },
    };
  }
  // function updatePara(para: ParagraphNode) {
  //   return makeParagraph(
  //     para.children.map((child) => {
  //       if (child.isBlock) {
  //         return mapNonTextInline(child);
  //       } else {
  //         return makeText(child.text, mapTextStyle(child.style), child.id);
  //       }
  //     }),
  //     mapParagraphSyle(para.style),
  //     para.id,
  //   );
  // }
  function updateParaText(para: ParagraphNode) {
    return makeParagraph(
      para.children.map((child) => {
        if (child.isBlock) {
          return mapNonTextInline(child);
        } else {
          return makeText(child.text, mapTextStyle(child.style), child.id);
        }
      }),
      mapParagraphSyle(para.style),
      para.id,
    );
  }
  function updateParaStyle(para: ParagraphNode) {
    return makeParagraph(para.children, mapParagraphSyle(para.style), para.id);
  }
  const range = orderSelection(editorCtrl.value, selection);
  const newValue = walkEditorValues(
    editorCtrl.value,
    (subValue, isSelected, ids) => {
      if (isSelected) {
        const newValue = makeEditorValue(
          subValue.blocks.map((block) => {
            if (block.isBlock) {
              return block;
              //   return mapNonParagraphBlock(block);
            }
            return updateParaStyle(updateParaText(block));
          }),
          subValue.id,
        );
        return {
          stop: false,
          data: isSelected,
          newValue,
        };
      }
      if (
        range.type === SelectionType.Table &&
        ids?.parentEditor.id === range.editorId &&
        ids.parentBlock.id === range.tableId
      ) {
        const table = ids.parentBlock as TableNode;
        const row = table.rows.find((row) =>
          row.cells.some((cell) => cell.value.id === subValue.id),
        )!;
        const rowIndex = table.rows.indexOf(row);
        const cell = row.cells.find((cell) => cell.value.id === subValue.id)!;
        const columnIndex = row.cells.indexOf(cell);
        if (
          ((range.startCell.rowIndex <= rowIndex &&
            rowIndex <= range.endCell.rowIndex) ||
            (range.endCell.rowIndex <= rowIndex &&
              rowIndex <= range.startCell.rowIndex)) &&
          ((range.startCell.columnIndex <= columnIndex &&
            columnIndex <= range.endCell.columnIndex) ||
            (range.endCell.columnIndex <= columnIndex &&
              columnIndex <= range.startCell.columnIndex))
        ) {
          const newValue = makeEditorValue(
            subValue.blocks.map((block) => {
              if (block.isBlock) {
                return block;
                //   return mapNonParagraphBlock(block);
              }
              return updateParaStyle(updateParaText(block));
            }),
            subValue.id,
          );
          return {
            stop: false,
            data: true,
            newValue,
          };
        } else {
          return {
            stop: false,
            data: true,
          };
        }
      }
      if (
        range.type === SelectionType.Block &&
        ids?.parentEditor.id === range.editorId
      ) {
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
          if (ids.parentBlock.type === BlockNodeType.Table) {
            const newValue = makeEditorValue(
              subValue.blocks.map((block) => {
                if (block.isBlock) {
                  return block;
                  //   return mapNonParagraphBlock(block);
                }
                return updateParaStyle(updateParaText(block));
              }),
              subValue.id,
            );
            return {
              stop: false,
              data: true,
              newValue,
            };
          }
          return {
            stop: false,
            data: true,
          };
        }
      }
      function doBoundaryShareId(
        paraA: ParagraphNode,
        paraB: ParagraphNode,
      ): boolean {
        return (
          paraA.children.length > 0 &&
          !paraA.children[paraA.children.length - 1].isBlock &&
          paraB.children.length > 0 &&
          !paraB.children[0].isBlock &&
          paraA.children[paraA.children.length - 1].id === paraB.children[0].id
        );
      }
      function fixBoundaryShareId(
        paraA: ParagraphNode,
        paraB: ParagraphNode,
      ): void {
        if (doBoundaryShareId(paraA, paraB)) {
          paraB.children[0] = makeText(
            (paraB.children[0] as TextNode).text,
            (paraB.children[0] as TextNode).style,
            editorCtrl.makeId(),
          );
        }
      }
      if (
        range.type === SelectionType.Block &&
        subValue.id === range.editorId
      ) {
        const startBlockIndex = subValue.blocks.findIndex(
          (block) => block.id === range.start.blockId,
        );
        const endBlockIndex = subValue.blocks.findIndex(
          (block) => block.id === range.end.blockId,
        );
        const newValue = makeEditorValue(
          subValue.blocks.map((block, idx) => {
            if (block.isBlock) {
              return block;
            }
            if (startBlockIndex <= idx && idx <= endBlockIndex) {
              if (idx === startBlockIndex) {
                const start = range.start as ParagraphPoint;
                if (idx === endBlockIndex) {
                  const end = range.end as ParagraphPoint;
                  const startPara = removeTextFromParagraph(
                    block,
                    start.offset,
                    Infinity,
                  );
                  const midPara = removeTextFromParagraph(
                    removeTextFromParagraph(block, end.offset, Infinity),
                    0,
                    start.offset,
                  );
                  const endPara = removeTextFromParagraph(block, 0, end.offset);
                  fixBoundaryShareId(startPara, midPara);
                  fixBoundaryShareId(midPara, endPara);
                  fixBoundaryShareId(startPara, endPara);
                  return updateParaStyle(
                    joinParagraphs(
                      joinParagraphs(startPara, updateParaText(midPara)),
                      endPara,
                    ),
                  );
                }
                const startPara = removeTextFromParagraph(
                  block,
                  start.offset,
                  Infinity,
                );
                const endPara = removeTextFromParagraph(block, 0, start.offset);
                fixBoundaryShareId(startPara, endPara);
                return updateParaStyle(
                  joinParagraphs(startPara, updateParaText(endPara)),
                );
              } else if (idx === endBlockIndex) {
                const end = range.end as ParagraphPoint;
                const startPara = removeTextFromParagraph(
                  block,
                  end.offset,
                  Infinity,
                );
                const endPara = removeTextFromParagraph(block, 0, end.offset);
                fixBoundaryShareId(startPara, endPara);
                return updateParaStyle(
                  joinParagraphs(updateParaText(startPara), endPara),
                );
              } else {
                return updateParaStyle(updateParaText(block));
              }
            }
            return block;
          }),
          subValue.id,
        );
        return {
          stop: false,
          data: false,
          newValue,
        };
      }
      return {
        stop: false,
        data: false,
      };
    },
    false,
    true,
  ).mappedEditor;
  return {
    value: newValue,
    mapSelection(selection, _isCursor) {
      return selection;
    },
  };
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
                makeParagraph(
                  firstBlock.children,
                  getParagraphLength(block) === 0
                    ? firstBlock.style
                    : block.style,
                  block.id,
                ),
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

function makeDOMBlockPoint(
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
          const inlineNode = block.children[0];
          if (inlineNode.isBlock) {
            throw new Error();
          }
          const node = editableElement.querySelector(
            `[data-id="${inlineNode.id}"]`,
          );
          if (!node) {
            console.log({ node });
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
    if (direction === Direction.Forwards) {
      domRange.setStart(start[0], start[1]);
      domRange.setEnd(end[0], end[1]);
    } else {
      domRange.setStart(end[0], end[1]);
      domRange.setEnd(start[0], start[1]);
    }
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
  if (direction === Direction.Forwards) {
    domRange.setStart(start[0], start[1]);
    domRange.setEnd(end[0], end[1]);
  } else {
    domRange.setStart(end[0], end[1]);
    domRange.setEnd(start[0], start[1]);
  }
  return domRange;
}

function extractSelection(
  value: EditorValue,
  selection: Selection,
): EditorValue {
  const range = orderSelection(value, selection);
  return walkEditorValues<EditorValue | undefined>(
    value,
    (subValue, _data, _ids) => {
      if (subValue.id !== range.editorId) {
        return {
          stop: false,
          data: undefined,
        };
      }
      if (range.type === SelectionType.Table) {
        const table = subValue.blocks.find(
          (block) => block.id === range.tableId,
        ) as TableNode;
        return {
          stop: true,
          data: makeEditorValue(
            [
              makeTable(
                table.rows
                  .slice(
                    Math.min(range.startCell.rowIndex, range.endCell.rowIndex),
                    Math.max(range.startCell.rowIndex, range.endCell.rowIndex) +
                      1,
                  )
                  .map((row) =>
                    makeTableRow(
                      row.cells.slice(
                        Math.min(
                          range.startCell.columnIndex,
                          range.endCell.columnIndex,
                        ),
                        Math.max(
                          range.startCell.columnIndex,
                          range.endCell.columnIndex,
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
        (block) => block.id === range.start.blockId,
      );
      const startBlock = subValue.blocks[startIndex];
      const endIndex = subValue.blocks.findIndex(
        (block) => block.id === range.end.blockId,
      );
      const endBlock = subValue.blocks[endIndex];
      const newBlocks = [];
      if (range.start.type === BlockSelectionPointType.OtherBlock) {
        newBlocks.push(startBlock);
      } else {
        if (startIndex === endIndex) {
          newBlocks.push(
            removeTextFromParagraph(
              removeTextFromParagraph(
                startBlock as ParagraphNode,
                (range.end as ParagraphPoint).offset,
                Infinity,
              ),
              0,
              range.start.offset,
            ),
          );
        } else {
          newBlocks.push(
            removeTextFromParagraph(
              startBlock as ParagraphNode,
              0,
              range.start.offset,
            ),
          );
        }
      }
      for (let i = startIndex + 1; i < endIndex; i++) {
        newBlocks.push(subValue.blocks[i]);
      }
      if (startIndex !== endIndex) {
        if (endBlock.isBlock) {
          newBlocks.push(endBlock);
        } else {
          newBlocks.push(
            removeTextFromParagraph(
              endBlock,
              (range.end as ParagraphPoint).offset,
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

function extractText(value: EditorValue): string {
  let text = '';
  function mapValue(value: EditorValue): void {
    value.blocks.forEach((block, idx) => {
      if (block.isBlock) {
        if (block.type === BlockNodeType.Table) {
          block.rows.map((row, rowIdx) => {
            row.cells.map((cell, cellIdx) => {
              mapValue(cell.value);
              if (cellIdx !== row.cells.length - 1) {
                text += ' ';
              }
            });
            if (rowIdx !== block.rows.length - 1) {
              text += ' ';
            }
          });
        }
      } else {
        block.children.forEach((child) => {
          if (child.type === InlineNodeType.Text) {
            text += child.text;
          }
        });
      }
      if (idx !== value.blocks.length - 1) {
        text += '\n';
      }
    });
  }
  mapValue(value);
  return text;
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

const NumberedListIndicesContext = createContext<Record<string, number>>({});

const isBrowser =
  typeof window === 'object' &&
  typeof document === 'object' &&
  document.nodeType === 9;

function allPass<T>(
  predicates: Array<(value: T) => boolean>,
): (value: T) => boolean {
  return (value) => predicates.every((func) => func(value));
}
function anyPass<T>(
  predicates: Array<(value: T) => boolean>,
): (value: T) => boolean {
  return (value) => predicates.some((func) => func(value));
}
function not<T>(predicate: (value: T) => boolean): (value: T) => boolean {
  return (value: T) => !predicate(value);
}

let isApple = false;
if (isBrowser) {
  isApple =
    /os ([\.\_\d]+) like mac os/i.test(window.navigator.userAgent) ||
    /mac os x/i.test(window.navigator.userAgent);
}

interface CompatibleKeyboardEvent {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly keyCode: number;
}

function hasShiftKey(event: CompatibleKeyboardEvent): boolean {
  return event.shiftKey;
}

function hasControlKey(event: CompatibleKeyboardEvent): boolean {
  return event.ctrlKey && !event.altKey && !event.metaKey;
}

function hasOptionKey(event: CompatibleKeyboardEvent): boolean {
  return isApple && event.altKey && !event.ctrlKey && !event.metaKey;
}

function hasCommandModifier(event: CompatibleKeyboardEvent): boolean {
  return isApple ? event.metaKey && !event.altKey : hasControlKey(event);
}

function hasNoModifiers(event: CompatibleKeyboardEvent): boolean {
  return !event.ctrlKey && !event.altKey && !event.metaKey;
}

function hasKeyCode(
  keyCode: number,
): (event: CompatibleKeyboardEvent) => boolean {
  return (event) => event.keyCode === keyCode;
}

const B = 66;
const I = 73;
const U = 85;
const J = 74;
const X = 88;
const Z = 90;
const Y = 89;
const H = 72;
const ONE = 49;
const TWO = 50;
const SEVEN = 55;
const EIGHT = 56;
const NINE = 57;
const FULLSTOP = 190;
const COMMA = 188;
const QUOTE = 222;
const BACKSLASH = 220;
const BACKSPACE = 8;

const isDeleteBackward = anyPass([
  allPass([
    (event: CompatibleKeyboardEvent) =>
      !isApple || !event.ctrlKey || event.altKey,
    hasKeyCode(BACKSPACE),
  ]),
  allPass([hasControlKey, not(hasShiftKey), hasKeyCode(H)]),
]);
const isUndo = anyPass([
  allPass([hasCommandModifier, not(hasShiftKey), hasKeyCode(Z)]),
  allPass([hasCommandModifier, hasShiftKey, hasKeyCode(Y)]),
]);
const isRedo = anyPass([
  allPass([hasCommandModifier, hasShiftKey, hasKeyCode(Z)]),
  allPass([hasCommandModifier, not(hasShiftKey), hasKeyCode(Y)]),
]);
const isBold = allPass([hasCommandModifier, not(hasShiftKey), hasKeyCode(B)]);
const isItalic = allPass([hasCommandModifier, not(hasShiftKey), hasKeyCode(I)]);
const isUnderline = allPass([
  hasCommandModifier,
  not(hasShiftKey),
  hasKeyCode(U),
]);
const isInlineCode = allPass([
  hasCommandModifier,
  not(hasShiftKey),
  hasKeyCode(J),
]);
const isStrikethrough = allPass([
  hasCommandModifier,
  hasShiftKey,
  hasKeyCode(X),
]);
const isSuperscript = allPass([
  hasCommandModifier,
  hasShiftKey,
  hasKeyCode(FULLSTOP),
]);
const isSubscript = allPass([
  hasCommandModifier,
  hasShiftKey,
  hasKeyCode(COMMA),
]);
const isTitle = allPass([hasCommandModifier, hasShiftKey, hasKeyCode(ONE)]);
const isSubtitle = allPass([hasCommandModifier, hasShiftKey, hasKeyCode(TWO)]);
const isCodeBlock = allPass([
  hasCommandModifier,
  hasShiftKey,
  hasKeyCode(SEVEN),
]);
const isQuote = allPass([
  hasCommandModifier,
  not(hasShiftKey),
  hasKeyCode(QUOTE),
]);
const isPullQuote = allPass([
  hasCommandModifier,
  hasShiftKey,
  hasKeyCode(QUOTE),
]);
const isBulletList = allPass([
  hasCommandModifier,
  hasShiftKey,
  hasKeyCode(EIGHT),
]);
const isNumberedList = allPass([
  hasCommandModifier,
  hasShiftKey,
  hasKeyCode(NINE),
]);
const isClearFormatting = allPass([
  hasCommandModifier,
  not(hasShiftKey),
  hasKeyCode(BACKSLASH),
]);

function anyBlockMatches(
  value: EditorValue,
  condition: (block: BlockNode) => boolean,
): boolean {
  let stop = false;
  function walkValue(value: EditorValue): void {
    for (let k = 0; k < value.blocks.length && !stop; k++) {
      const block = value.blocks[k];
      if (condition(block)) {
        stop = true;
        return;
      }
      if (block.isBlock && block.type === BlockNodeType.Table) {
        for (let i = 0; i < block.rows.length && !stop; i++) {
          for (let j = 0; j < block.rows[i].cells.length && !stop; j++) {
            const cell = block.rows[i].cells[j];
            walkValue(cell.value);
          }
        }
      }
    }
  }
  walkValue(value);
  return stop;
}

function anyTextMatches(
  value: EditorValue,
  condition: (text: TextNode) => boolean,
): boolean {
  return anyBlockMatches(value, (block) => {
    if (block.isBlock) {
      return false;
    }
    return block.children.some((child) => !child.isBlock && condition(child));
  });
}

function isInlineActiveStyle(
  value: EditorValue,
  selection: Selection,
  condition: (style: TextStyle) => boolean,
): boolean {
  if (isCollapsed(selection)) {
    if (selection.type !== SelectionType.Block) {
      return false;
    }
    const point = selection.start;
    if (point.type !== BlockSelectionPointType.Paragraph) {
      return false;
    }
    return walkEditorValues<boolean>(
      value,
      (subValue, _data, _ids) => {
        if (subValue.id !== selection.editorId) {
          return {
            stop: false,
            data: false,
          };
        }
        const para = subValue.blocks.find(
          (block) => block.id === point.blockId,
        ) as ParagraphNode;
        const start = removeTextFromParagraph(para, point.offset, Infinity);
        return {
          stop: true,
          data: condition(
            (start.children[start.children.length - 1] as TextNode).style,
          ),
        };
      },
      false,
      false,
    ).retValue;
  }
  return !anyTextMatches(
    extractSelection(value, selection),
    (text) => !condition(text.style),
  );
}

function getSelectionTextStyle(
  value: EditorValue,
  selection: Selection,
): TextStyle {
  return {
    bold: isInlineActiveStyle(value, selection, (style) => !!style.bold)
      ? true
      : undefined,
    code: isInlineActiveStyle(value, selection, (style) => !!style.code)
      ? true
      : undefined,
    italic: isInlineActiveStyle(value, selection, (style) => !!style.italic)
      ? true
      : undefined,
    script: isInlineActiveStyle(
      value,
      selection,
      (style) => style.script === TextScript.Superscript,
    )
      ? TextScript.Superscript
      : isInlineActiveStyle(
          value,
          selection,
          (style) => style.script === TextScript.Subscript,
        )
      ? TextScript.Subscript
      : undefined,
    strikethrough: isInlineActiveStyle(
      value,
      selection,
      (style) => !!style.strikethrough,
    )
      ? true
      : undefined,
    underline: isInlineActiveStyle(
      value,
      selection,
      (style) => !!style.underline,
    )
      ? true
      : undefined,
  };
}

function toggleInlineStyle(
  editorCtrl: EditorController,
  selection: Selection,
  condition: (style: TextStyle) => boolean,
  update: (style: TextStyle, active: boolean) => TextStyle,
): { value: EditorValue; textStyle: TextStyle } {
  if (isCollapsed(selection)) {
    return {
      value: editorCtrl.value,
      textStyle: update(editorCtrl.textStyle, condition(editorCtrl.textStyle)),
    };
  }
  const active = !anyTextMatches(
    extractSelection(editorCtrl.value, selection),
    (text) => !condition(text.style),
  );
  const edit = mapNodes(
    editorCtrl,
    selection,
    (block) => block,
    (paraS) => paraS,
    (textS) => update(textS, active),
  );
  return {
    value: edit.value,
    textStyle: getSelectionTextStyle(editorCtrl.value, selection),
  };
}

function getEndParagraphStyle(
  value: EditorValue,
  selection: Selection,
): ParagraphStyle {
  if (selection.type === SelectionType.Table) {
    return { type: ParagraphStyleType.Default };
  }
  const point = selection.end;
  if (point.type !== BlockSelectionPointType.Paragraph) {
    return { type: ParagraphStyleType.Default };
  }
  return walkEditorValues<ParagraphStyle | undefined>(
    value,
    (subValue, _data, _ids) => {
      if (subValue.id !== selection.editorId) {
        return {
          stop: false,
          data: undefined,
        };
      }
      const para = subValue.blocks.find(
        (block) => block.id === point.blockId,
      ) as ParagraphNode;
      return {
        stop: true,
        data: para.style,
      };
    },
    undefined,
    false,
  ).retValue!;
}

function isParagraphStyleActive(
  value: EditorValue,
  selection: Selection,
  condition: (style: ParagraphStyle) => boolean,
): boolean {
  if (isCollapsed(selection)) {
    if (selection.type !== SelectionType.Block) {
      return false;
    }
    const point = selection.start;
    if (point.type !== BlockSelectionPointType.Paragraph) {
      return false;
    }
    return walkEditorValues<boolean>(
      value,
      (subValue, _data, _ids) => {
        if (subValue.id !== selection.editorId) {
          return {
            stop: false,
            data: false,
          };
        }
        const para = subValue.blocks.find(
          (block) => block.id === point.blockId,
        ) as ParagraphNode;
        return {
          stop: true,
          data: condition(para.style),
        };
      },
      false,
      false,
    ).retValue;
  }
  return !anyBlockMatches(
    extractSelection(value, selection),
    (block) => !block.isBlock && !condition(block.style),
  );
}

function toggleParagraphStyle(
  editorCtrl: EditorController,
  selection: Selection,
  condition: (style: ParagraphStyle) => boolean,
  update: (style: ParagraphStyle, active: boolean) => ParagraphStyle,
): { value: EditorValue } {
  if (isCollapsed(selection)) {
    if (selection.type !== SelectionType.Block) {
      throw new Error();
    }
    const point = selection.start;
    if (point.type !== BlockSelectionPointType.Paragraph) {
      return {
        value: editorCtrl.value,
      };
    }
    const value = walkEditorValues(
      editorCtrl.value,
      (subValue, _data, _ids) => {
        if (subValue.id !== selection.editorId) {
          return {
            stop: false,
            data: undefined,
          };
        }
        let newBlocks = subValue.blocks.map((block) => {
          if (block.id === point.blockId) {
            const active = condition((block as ParagraphNode).style);
            const newStyle = update((block as ParagraphNode).style, active);
            return makeParagraph(
              (block as ParagraphNode).children,
              newStyle,
              block.id,
            );
          }
          return block;
        });
        return {
          stop: false,
          data: undefined,
          newValue: makeEditorValue(newBlocks, subValue.id),
        };
      },
      undefined,
      true,
    ).mappedEditor;
    return {
      value,
    };
  }
  const active = !anyBlockMatches(
    extractSelection(editorCtrl.value, selection),
    (block) => !block.isBlock && !condition(block.style),
  );
  const edit = mapNodes(
    editorCtrl,
    selection,
    (block) => block,
    (paraS) => update(paraS, active),
    (textS) => textS,
  );
  return {
    value: edit.value,
  };
}

function isScrollable(element: Element): boolean {
  const style = window.getComputedStyle(element);
  const { overflowY } = style;

  return (
    (overflowY && overflowY === 'auto') ||
    overflowY === 'overlay' ||
    overflowY === 'scroll'
  );
}

function findScrollContainer(node: Node): HTMLElement {
  let parent = node.parentNode as HTMLElement;
  let scroller: HTMLElement | undefined;

  while (!scroller) {
    if (!parent || !parent.parentNode) {
      break;
    }

    if (isScrollable(parent)) {
      scroller = parent;
      break;
    }

    parent = parent.parentNode as HTMLElement;
  }

  // COMPAT: Because Chrome does not allow document.body.scrollTop, we're
  // assuming that window.scrollTo() should be used if the scrollable element
  // turns out to be document.body or document.documentElement. This will work
  // unless body is intentionally set to scrollable by restricting its height
  // (e.g. height: 100vh).
  if (!scroller) {
    return window.document.body;
  }

  return scroller;
}

function isDomSelectionBackward(selection: globalThis.Selection): boolean {
  const position = selection.anchorNode!.compareDocumentPosition(
    selection.focusNode!,
  );

  return !(
    position === 4 /* Node.DOCUMENT_POSITION_FOLLOWING */ ||
    (position === 0 && selection.anchorOffset < selection.focusOffset)
  );
}

function scrollIntoView(
  selection: globalThis.Selection,
  scroller?: HTMLElement,
) {
  if (!selection.anchorNode) {
    return;
  }

  if (!scroller) {
    scroller = findScrollContainer(selection.anchorNode);
    if (
      scroller !== window.document.body &&
      scroller !== window.document.documentElement
    ) {
      let s = scroller;
      while (true) {
        s = findScrollContainer(s);
        scrollIntoView(selection, s);
        if (
          s === window.document.body ||
          s === window.document.documentElement
        ) {
          break;
        }
      }
    }
  }
  const isWindow =
    scroller === window.document.body ||
    scroller === window.document.documentElement;
  const backward = isDomSelectionBackward(selection);

  const range = selection.getRangeAt(0).cloneRange();
  range.collapse(backward);
  let cursorRect = range.getBoundingClientRect();

  // COMPAT: range.getBoundingClientRect() returns 0s when range is
  // collapsed. Expanding the range by 1 is a relatively effective workaround
  // for vertical scroll, although horizontal may be off by 1 character.
  // https://bugs.webkit.org/show_bug.cgi?id=138949
  // https://bugs.chromium.org/p/chromium/issues/detail?id=435438
  if (range.collapsed && cursorRect.top === 0 && cursorRect.height === 0) {
    if (range.startContainer.nodeName === 'BR') {
      cursorRect = (
        range.startContainer as HTMLElement
      ).getBoundingClientRect();
    } else {
      if (range.startOffset === 0) {
        range.setEnd(range.endContainer, 1);
      } else {
        range.setStart(range.startContainer, range.startOffset - 1);
      }

      cursorRect = range.getBoundingClientRect();

      if (cursorRect.top === 0 && cursorRect.height === 0) {
        if (range.getClientRects().length) {
          cursorRect = range.getClientRects()[0];
        }
      }
    }
  }

  let width;
  let height;
  let yOffset;
  let xOffset;
  let scrollerTop = 0;
  let scrollerLeft = 0;
  let scrollerBordersY = 0;
  let scrollerBordersX = 0;
  let scrollerPaddingTop = 0;
  let scrollerPaddingBottom = 0;
  let scrollerPaddingLeft = 0;
  let scrollerPaddingRight = 0;

  if (isWindow) {
    const clientWidth = document.documentElement.clientWidth;
    const clientHeight = document.documentElement.clientHeight;
    const { pageYOffset, pageXOffset } = window;
    width = clientWidth;
    height = clientHeight;
    yOffset = pageYOffset;
    xOffset = pageXOffset;
  } else {
    const { top, left } = scroller.getBoundingClientRect();
    const style = window.getComputedStyle(scroller);
    const borderTopWidth = parseInt(style.borderTopWidth || '0', 10);
    const borderBottomWidth = parseInt(style.borderBottomWidth || '0', 10);
    const borderLeftWidth = parseInt(style.borderLeftWidth || '0', 10);
    const borderRightWidth = parseInt(style.borderRightWidth || '0', 10);
    const paddingTop = parseInt(style.paddingTop || '0', 10);
    const paddingBottom = parseInt(style.paddingBottom || '0', 10);
    const paddingLeft = parseInt(style.paddingLeft || '0', 10);
    const paddingRight = parseInt(style.paddingRight || '0', 10);

    width = scroller.clientWidth;
    height = scroller.clientHeight;
    scrollerTop = top + borderTopWidth;
    scrollerLeft = left + borderLeftWidth;
    scrollerBordersY = borderTopWidth + borderBottomWidth;
    scrollerBordersX = borderLeftWidth + borderRightWidth;
    scrollerPaddingTop = paddingTop;
    scrollerPaddingBottom = paddingBottom;
    scrollerPaddingLeft = paddingLeft;
    scrollerPaddingRight = paddingRight;
    yOffset = scroller.scrollTop;
    xOffset = scroller.scrollLeft;
  }

  const cursorTop = cursorRect.top + yOffset - scrollerTop;
  const cursorLeft = cursorRect.left + xOffset - scrollerLeft;

  let x = xOffset;
  let y = yOffset;

  if (cursorLeft < xOffset) {
    // selection to the left of viewport
    x = cursorLeft - scrollerPaddingLeft;
  } else if (
    cursorLeft + cursorRect.width + scrollerBordersX >
    xOffset + width
  ) {
    // selection to the right of viewport
    x = cursorLeft + scrollerBordersX + scrollerPaddingRight - width;
  }

  if (cursorTop < yOffset) {
    // selection above viewport
    y = cursorTop - scrollerPaddingTop;
  } else if (
    cursorTop + cursorRect.height + scrollerBordersY >
    yOffset + height
  ) {
    // selection below viewport
    y =
      cursorTop +
      scrollerBordersY +
      scrollerPaddingBottom +
      cursorRect.height -
      height;
  }

  if (isWindow) {
    window.scrollTo(x, y);
  } else {
    scroller.scrollTop = y;
    scroller.scrollLeft = x;
  }
}

enum CommandType {
  Input,
  InlineFormat,
  BlockFormat,
  ClearFormat,
  Undo,
  Redo,
  DeleteBackwardKey,
}
type Command =
  | {
      type: CommandType.Input;
      inputType: string;
      selection: Selection;
      data?: EditorDataTransfer;
    }
  | {
      type: CommandType.InlineFormat;
      selection: Selection;
      condition: (style: TextStyle) => boolean;
      transform: (style: TextStyle, active: boolean) => TextStyle;
    }
  | {
      type: CommandType.BlockFormat;
      selection: Selection;
      condition: (style: ParagraphStyle) => boolean;
      transform: (style: ParagraphStyle, active: boolean) => ParagraphStyle;
    }
  | {
      type: CommandType.ClearFormat | CommandType.Redo | CommandType.Undo;
      selection: Selection;
    }
  | { type: CommandType.DeleteBackwardKey; selection: Selection };
const cmds: {
  isKey: (event: KeyboardEvent) => boolean;
  icon?: {
    name: string;
    isActive: (editorCtrl: EditorController) => boolean;
    Icon: typeof ToolbarIcon;
  };
  getCmds: (selection: Selection, makeId: () => string) => Command[];
}[] = [
  {
    isKey: isBold,
    icon: {
      name: 'bold',
      isActive: (c) => !!c.textStyle.bold,
      Icon: BoldIcon,
    },
    getCmds: (selection) => [
      {
        type: CommandType.InlineFormat,
        selection,
        condition: (style) => !!style.bold,
        transform: (style, active) => ({
          ...style,
          bold: active ? undefined : true,
        }),
      },
    ],
  },
  {
    isKey: isItalic,
    icon: {
      name: 'italic',
      isActive: (c) => !!c.textStyle.italic,
      Icon: ItalicIcon,
    },
    getCmds: (selection) => [
      {
        type: CommandType.InlineFormat,
        selection,
        condition: (style) => !!style.italic,
        transform: (style, active) => ({
          ...style,
          italic: active ? undefined : true,
        }),
      },
    ],
  },
  {
    isKey: isUnderline,
    icon: {
      name: 'underline',
      isActive: (c) => !!c.textStyle.underline,
      Icon: UnderlineIcon,
    },
    getCmds: (selection) => [
      {
        type: CommandType.InlineFormat,
        selection,
        condition: (style) => !!style.underline,
        transform: (style, active) => ({
          ...style,
          underline: active ? undefined : true,
        }),
      },
    ],
  },
  {
    isKey: isInlineCode,
    icon: {
      name: 'inline code',
      isActive: (c) => !!c.textStyle.code,
      Icon: InlineCodeIcon,
    },
    getCmds: (selection) => [
      {
        type: CommandType.InlineFormat,
        selection,
        condition: (style) => !!style.code,
        transform: (style, active) => ({
          ...style,
          code: active ? undefined : true,
        }),
      },
    ],
  },
  {
    isKey: isStrikethrough,
    icon: {
      name: 'strikethrough',
      isActive: (c) => !!c.textStyle.strikethrough,

      Icon: StrikethroughIcon,
    },
    getCmds: (selection) => [
      {
        type: CommandType.InlineFormat,
        selection,
        condition: (style) => !!style.strikethrough,
        transform: (style, active) => ({
          ...style,
          strikethrough: active ? undefined : true,
        }),
      },
    ],
  },
  {
    isKey: isSuperscript,
    icon: {
      name: 'superscript',
      isActive: (c) => c.textStyle.script === TextScript.Superscript,
      Icon: SuperscriptIcon,
    },
    getCmds: (selection) => [
      {
        type: CommandType.InlineFormat,
        selection,
        condition: (style) => style.script === TextScript.Superscript,
        transform: (style, active) => ({
          ...style,
          script: active ? undefined : TextScript.Superscript,
        }),
      },
    ],
  },
  {
    isKey: isSubscript,
    icon: {
      name: 'subscript',
      isActive: (c) => c.textStyle.script === TextScript.Subscript,
      Icon: SubscriptIcon,
    },
    getCmds: (selection) => [
      {
        type: CommandType.InlineFormat,
        selection,
        condition: (style) => style.script === TextScript.Subscript,
        transform: (style, active) => ({
          ...style,
          script: active ? undefined : TextScript.Subscript,
        }),
      },
    ],
  },
  {
    isKey: isTitle,
    icon: {
      name: 'title',
      isActive: (c) =>
        isParagraphStyleActive(
          c.value,
          c.selection!,
          (style) => style.type === ParagraphStyleType.Title,
        ),
      Icon: TitleIcon,
    },
    getCmds: (selection) => [
      {
        type: CommandType.BlockFormat,
        selection,
        condition: (style) => style.type === ParagraphStyleType.Title,
        transform: (style, active) => ({
          type: active ? ParagraphStyleType.Default : ParagraphStyleType.Title,
        }),
      },
    ],
  },
  {
    isKey: isSubtitle,
    icon: {
      name: 'subtitle',
      isActive: (c) =>
        isParagraphStyleActive(
          c.value,
          c.selection!,
          (style) => style.type === ParagraphStyleType.Subtitle,
        ),
      Icon: SubtitleIcon,
    },
    getCmds: (selection) => [
      {
        type: CommandType.BlockFormat,
        selection,
        condition: (style) => style.type === ParagraphStyleType.Subtitle,
        transform: (style, active) => ({
          type: active
            ? ParagraphStyleType.Default
            : ParagraphStyleType.Subtitle,
        }),
      },
    ],
  },
  {
    isKey: isQuote,
    icon: {
      name: 'quote',
      isActive: (c) =>
        isParagraphStyleActive(
          c.value,
          c.selection!,
          (style) => style.type === ParagraphStyleType.Quote,
        ),
      Icon: QuoteIcon,
    },
    getCmds: (selection) => [
      {
        type: CommandType.BlockFormat,
        selection,
        condition: (style) => style.type === ParagraphStyleType.Quote,
        transform: (style, active) => ({
          type: active ? ParagraphStyleType.Default : ParagraphStyleType.Quote,
        }),
      },
    ],
  },
  {
    isKey: isPullQuote,
    icon: {
      name: 'pull quote',
      isActive: (c) =>
        isParagraphStyleActive(
          c.value,
          c.selection!,
          (style) => style.type === ParagraphStyleType.PullQuote,
        ),
      Icon: PullQuoteIcon,
    },
    getCmds: (selection) => [
      {
        type: CommandType.BlockFormat,
        selection,
        condition: (style) => style.type === ParagraphStyleType.PullQuote,
        transform: (style, active) => ({
          type: active
            ? ParagraphStyleType.Default
            : ParagraphStyleType.PullQuote,
        }),
      },
    ],
  },
  {
    isKey: isBulletList,
    icon: {
      name: 'bullet list',
      isActive: (c) =>
        isParagraphStyleActive(
          c.value,
          c.selection!,
          (style) => style.type === ParagraphStyleType.BulletList,
        ),
      Icon: BulletListIcon,
    },
    getCmds: (selection, makeId) => {
      let newId: string | null = null;
      let getNewId = () => {
        if (newId === null) {
          newId = makeId();
        }
        return newId;
      };
      return [
        {
          type: CommandType.BlockFormat,
          selection,
          condition: (style) => style.type === ParagraphStyleType.BulletList,
          transform: (style, active) =>
            active
              ? { type: ParagraphStyleType.Default }
              : {
                  type: ParagraphStyleType.BulletList,
                  listId: getNewId(),
                },
        },
      ];
    },
  },
  {
    isKey: isNumberedList,
    icon: {
      name: 'numbered list',
      isActive: (c) =>
        isParagraphStyleActive(
          c.value,
          c.selection!,
          (style) => style.type === ParagraphStyleType.NumberedList,
        ),
      Icon: NumberedListIcon,
    },
    getCmds: (selection, makeId) => {
      let newId: string | null = null;
      let getNewId = () => {
        if (newId === null) {
          newId = makeId();
        }
        return newId;
      };
      return [
        {
          type: CommandType.BlockFormat,
          selection,
          condition: (style) => style.type === ParagraphStyleType.NumberedList,
          transform: (style, active) =>
            active
              ? { type: ParagraphStyleType.Default }
              : {
                  type: ParagraphStyleType.NumberedList,
                  listId: getNewId(),
                },
        },
      ];
    },
  },
  {
    isKey: isClearFormatting,
    icon: undefined,
    getCmds: (selection) => [
      {
        type: CommandType.ClearFormat,
        selection,
      },
    ],
  },
  {
    isKey: isUndo,
    getCmds: (selection) => [
      {
        type: CommandType.Undo,
        selection,
      },
    ],
  },
  {
    isKey: isRedo,
    getCmds: (selection) => [
      {
        type: CommandType.Redo,
        selection,
      },
    ],
  },
  {
    isKey: isDeleteBackward,
    getCmds: (selection) => [
      {
        type: CommandType.DeleteBackwardKey,
        selection,
      },
    ],
  },
];

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

function useCustomCompareMemo<T, TDependencyList extends React.DependencyList>(
  factory: () => T,
  deps: readonly [...TDependencyList],
  depsAreEqual: DepsAreEqual<readonly [...TDependencyList]>,
): T {
  return useMemo(factory, useCustomCompareMemoize(deps, depsAreEqual));
}

type DepsAreEqual<TDependencyList extends React.DependencyList> = (
  prevDeps: TDependencyList,
  nextDeps: TDependencyList,
) => boolean;

function useCustomCompareMemoize<TDependencyList extends React.DependencyList>(
  deps: readonly [...TDependencyList],
  depsAreEqual: DepsAreEqual<readonly [...TDependencyList]>,
) {
  const ref = useRef<readonly [...TDependencyList] | undefined>(undefined);

  if (!ref.current || !depsAreEqual(ref.current, deps)) {
    ref.current = deps;
  }

  return ref.current;
}

function ReactEditor({
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
    textStyle: {},
    undos: [],
    redos: [],
    lastAction: PushStateAction.Selection,
    makeId,
  });
  const isUpdatingSelection = useRef<number>(0);
  const inputQueueRef = useRef<Command[]>([]);
  const inputQueueRequestRef = useRef<number | null>(null);
  let newDomSelectionRef = useRef<Selection | null>(null);
  const [_renderToggle, setRenderToggle] = useState(false);

  const updateSelection = (newSelection: Selection): void => {
    editorRef.current!.focus();

    const native = window.getSelection()!;

    const { rangeCount } = native;

    const current = !!rangeCount && native.getRangeAt(0);
    const range = makeDOMRange(
      newSelection,
      editorCtrl.current.value,
      editorRef.current!,
    );

    isUpdatingSelection.current++;
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

    setTimeout(() => {
      isUpdatingSelection.current--;
    });
  };

  function pushState(
    curEditorCtrl: EditorController,
    newValue: EditorValue,
    newSelection: Selection,
    newTextStyle: TextStyle,
    action: PushStateAction,
  ): EditorController {
    let undos = curEditorCtrl.undos;
    if (
      action !== PushStateAction.Selection &&
      (action === PushStateAction.Unique || curEditorCtrl.lastAction !== action)
    ) {
      undos = [...undos, curEditorCtrl];
    }
    let redos = curEditorCtrl.redos;
    if (action !== PushStateAction.Selection) {
      redos = [];
    }
    return {
      value: newValue,
      selection: newSelection,
      textStyle: newTextStyle,
      undos,
      redos,
      lastAction: action,
      makeId,
    };
  }

  const flushInputQueue = (): void => {
    inputQueueRequestRef.current = null;
    let mapSelectionFns: ((
      selection: Selection,
      isCursor: boolean,
    ) => Selection)[] = [];
    const queue = inputQueueRef.current;
    inputQueueRef.current = [];
    let newEditorCtrl = editorCtrl.current;
    console.log(queue);
    let dropValue: EditorValue | null = null;
    let ignoreDelete: boolean = false;
    let ignoreSelectionN = 0;
    for (let i = 0; i < queue.length; i++) {
      const command = queue[i];
      const originalSelection = command.selection;
      const inputSelection = mapSelectionFns.reduce(
        (selection, mapSelection) => mapSelection(selection, true),
        originalSelection,
      );
      if (command.type === CommandType.Input) {
        const { inputType, data } = command;
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
            if (ignoreDelete) {
              ignoreDelete = false;
              continue;
            }
            let action: PushStateAction;
            if (inputType === 'deleteByCut' || inputType === 'deleteByDrag') {
              action = PushStateAction.Unique;
            } else {
              action = PushStateAction.Delete;
            }
            if (inputType === 'deleteByCut') {
              copySelection(newEditorCtrl.value, inputSelection);
            }
            if (inputType === 'deleteByDrag') {
              if (i < queue.length - 1) {
                const next = queue[i + 1];
                if (
                  next.type === CommandType.Input &&
                  next.inputType === 'insertFromDrop'
                ) {
                  dropValue = extractSelection(
                    newEditorCtrl.value,
                    inputSelection,
                  );
                }
              }
            }
            const edit = removeSelection(newEditorCtrl, inputSelection);
            const newSelection = edit.mapSelection(inputSelection, true);
            newEditorCtrl = pushState(
              newEditorCtrl,
              edit.value,
              newSelection,
              getSelectionTextStyle(newEditorCtrl.value, newSelection),
              action,
            );
            mapSelectionFns.push(edit.mapSelection);
            break;
          }
          case 'insertFromYank':
          case 'insertReplacementText':
          case 'insertText':
          case 'insertFromPaste':
          case 'insertFromDrop': {
            let action: PushStateAction;
            if (
              inputType === 'insertReplacementText' ||
              inputType === 'insertFromYank' ||
              inputType === 'insertFromPaste' ||
              inputType === 'insertFromDrop' ||
              (inputType === 'insertText' &&
                data?.type === DataTransferType.Plain &&
                data.text.includes('\n'))
            ) {
              action = PushStateAction.Unique;
            } else {
              action = PushStateAction.Insert;
            }
            if (!data) {
              return;
            }
            let insertValue: EditorValue;
            if (dropValue !== null) {
              insertValue = dropValue;
              dropValue = null;
            } else if (data.type === DataTransferType.Rich) {
              insertValue = data.value;
            } else {
              const style = getEndParagraphStyle(
                newEditorCtrl.value,
                inputSelection,
              );
              insertValue = makeEditorValue(
                data.text
                  .split(/\r?\n/)
                  .map((paraText) =>
                    makeParagraph(
                      [makeText(paraText, newEditorCtrl.textStyle, makeId())],
                      style,
                      makeId(),
                    ),
                  ),
                makeId(),
              );
            }
            const edit = insertSelection(
              newEditorCtrl,
              inputSelection,
              insertValue,
            );
            const newValue = edit.value;
            const newSelection = edit.mapSelection(inputSelection, true);
            const newTextStyle = getSelectionTextStyle(newValue, newSelection);
            newEditorCtrl = pushState(
              newEditorCtrl,
              newValue,
              newSelection,
              newTextStyle,
              action,
            );
            mapSelectionFns.push(edit.mapSelection);
            break;
          }
          case 'insertParagraph':
          case 'insertLineBreak': {
            let action = PushStateAction.Unique;
            const style = getEndParagraphStyle(
              newEditorCtrl.value,
              inputSelection,
            );
            const insertValue = makeEditorValue(
              inputType === 'insertParagraph'
                ? [
                    makeParagraph(
                      [makeText('', newEditorCtrl.textStyle, makeId())],
                      style,
                      makeId(),
                    ),
                    makeParagraph(
                      [makeText('', newEditorCtrl.textStyle, makeId())],
                      style,
                      makeId(),
                    ),
                  ]
                : [
                    makeParagraph(
                      [makeText('\n', newEditorCtrl.textStyle, makeId())],
                      style,
                      makeId(),
                    ),
                  ],
              makeId(),
            );
            const edit = insertSelection(
              newEditorCtrl,
              inputSelection,
              insertValue,
            );
            const newValue = edit.value;
            const newSelection = edit.mapSelection(inputSelection, true);
            const newTextStyle = getSelectionTextStyle(newValue, newSelection);
            newEditorCtrl = pushState(
              newEditorCtrl,
              newValue,
              newSelection,
              newTextStyle,
              action,
            );
            mapSelectionFns.push(edit.mapSelection);
            break;
          }
        }
      } else if (command.type === CommandType.InlineFormat) {
        const edit = toggleInlineStyle(
          newEditorCtrl,
          inputSelection,
          command.condition,
          command.transform,
        );
        let newValue = newEditorCtrl.value;
        if (isCollapsed(inputSelection)) {
          ignoreSelectionN++;
        } else {
          newValue = edit.value;
        }
        let newTextStyle = edit.textStyle;
        newEditorCtrl = pushState(
          newEditorCtrl,
          newValue,
          inputSelection,
          newTextStyle,
          PushStateAction.Unique,
        );
      } else if (command.type === CommandType.BlockFormat) {
        const edit = toggleParagraphStyle(
          newEditorCtrl,
          inputSelection,
          command.condition,
          command.transform,
        );
        newEditorCtrl = pushState(
          newEditorCtrl,
          edit.value,
          inputSelection,
          newEditorCtrl.textStyle,
          PushStateAction.Unique,
        );
      } else if (command.type === CommandType.ClearFormat) {
        const editInline = toggleInlineStyle(
          newEditorCtrl,
          inputSelection,
          () => false,
          () => ({}),
        );
        let newEditorCtrlInlineWiped = {
          ...newEditorCtrl,
          value: editInline.value,
        };
        const editBlock = toggleParagraphStyle(
          newEditorCtrlInlineWiped,
          inputSelection,
          () => false,
          () => ({ type: ParagraphStyleType.Default }),
        );
        newEditorCtrl = pushState(
          newEditorCtrl,
          editBlock.value,
          inputSelection,
          {},
          PushStateAction.Unique,
        );
      } else if (command.type === CommandType.Undo) {
        if (newEditorCtrl.undos.length === 0) {
          continue;
        }
        const end = newEditorCtrl.undos[newEditorCtrl.undos.length - 1];
        newEditorCtrl = {
          value: end.value,
          selection: end.selection,
          textStyle: end.textStyle,
          undos: newEditorCtrl.undos.slice(0, newEditorCtrl.undos.length - 1),
          redos: [newEditorCtrl, ...newEditorCtrl.redos],
          lastAction: PushStateAction.Unique,
          makeId,
        };
      } else if (command.type === CommandType.Redo) {
        if (newEditorCtrl.redos.length === 0) {
          continue;
        }
        const start = newEditorCtrl.redos[0];
        newEditorCtrl = {
          value: start.value,
          selection: start.selection,
          textStyle: start.textStyle,
          undos: [...newEditorCtrl.undos, newEditorCtrl],
          redos: newEditorCtrl.redos.slice(1),
          lastAction: PushStateAction.Unique,
          makeId,
        };
      } else if (command.type === CommandType.DeleteBackwardKey) {
        if (!isCollapsed(inputSelection)) {
          continue;
        }
        const point = (inputSelection as BlockSelection).start;
        if (
          point.type !== BlockSelectionPointType.Paragraph ||
          point.offset !== 0
        ) {
          continue;
        }
        const res = walkEditorValues<boolean | undefined>(
          editorCtrl.current.value,
          (subValue, _data, _ids) => {
            if (subValue.id !== inputSelection.editorId) {
              return {
                stop: false,
                data: undefined,
              };
            }
            const para = subValue.blocks.find(
              (block) => block.id === point.blockId,
            ) as ParagraphNode;
            const { style } = para;
            if (
              style.type === ParagraphStyleType.BulletList ||
              style.type === ParagraphStyleType.NumberedList ||
              style.type === ParagraphStyleType.PullQuote ||
              style.type === ParagraphStyleType.Quote
            ) {
              return {
                stop: true,
                data: true,
                newValue: makeEditorValue(
                  subValue.blocks.map((block) => {
                    if (block.id === point.blockId) {
                      return makeDefaultParagraph(para.children, para.id);
                    }
                    return block;
                  }),
                  subValue.id,
                ),
              };
            }
            return {
              stop: true,
              data: undefined,
            };
          },
          undefined,
          true,
        );
        if (res.retValue) {
          newEditorCtrl = pushState(
            newEditorCtrl,
            res.mappedEditor,
            inputSelection,
            newEditorCtrl.textStyle,
            PushStateAction.Unique,
          );
          if (i < queue.length - 1) {
            const next = queue[i + 1];
            if (
              next.type === CommandType.Input &&
              (next.inputType === 'deleteContentBackward' ||
                next.inputType === 'deleteWordBackward' ||
                next.inputType === 'deleteSoftLineBackward' ||
                next.inputType === 'deleteHardLineBackward')
            ) {
              ignoreDelete = true;
            }
          }
        }
      }
    }
    editorCtrl.current = newEditorCtrl;
    if (ignoreSelectionN < queue.length) {
      newDomSelectionRef.current = newEditorCtrl.selection;
    }
    setRenderToggle((t) => !t);
  };

  useEffect(() => {
    if (newDomSelectionRef.current !== null) {
      updateSelection(newDomSelectionRef.current);
      newDomSelectionRef.current = null;
      const selection = window.getSelection();
      if (!selection) {
        console.error('no dom selection after set manually');
        return;
      }
      scrollIntoView(selection);
    }
  });

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
      const html = event.dataTransfer.getData('text/html');
      if (html) {
        const parser = new DOMParser();
        let parsedDocument: Document | null = null;
        try {
          parsedDocument = parser.parseFromString(html, 'text/html');
        } catch (error) {
          console.error(error);
        }
        if (parsedDocument !== null) {
          const encodeNode = parsedDocument.querySelector('[data-matita]');
          if (encodeNode) {
            let value: EditorValue | null = null;
            try {
              value = JSON.parse(encodeNode.getAttribute('data-matita')!);
            } catch (error) {
              console.error(error);
            }
            if (value !== null) {
              data = {
                type: DataTransferType.Rich,
                value: mapValue(value),
              };
            }
          }
        }
        if (!data) {
          console.log(parsedDocument);
        }
      }
      if (!data) {
        const plain = event.dataTransfer.getData('text/plain');
        if (plain) {
          data = {
            type: DataTransferType.Plain,
            text: plain,
          };
        }
      }
    }
    if (!data && event.data) {
      data = {
        type: DataTransferType.Plain,
        text: event.data,
      };
    }
    queueCommand({
      type: CommandType.Input,
      inputType: event.inputType,
      selection,
      data,
    });
  };

  function queueCommand(command: Command): void {
    if (inputQueueRef.current.length === 0) {
      if (
        !(command.type === CommandType.DeleteBackwardKey) &&
        !(
          command.type === CommandType.Input &&
          command.inputType === 'deleteByDrag'
        )
      ) {
        inputQueueRef.current.push(command);
        flushInputQueue();
        return;
      }
      inputQueueRequestRef.current = requestAnimationFrame(flushInputQueue);
    } else {
      const lastCommand =
        inputQueueRef.current[inputQueueRef.current.length - 1];
      if (
        lastCommand.type === CommandType.DeleteBackwardKey ||
        (lastCommand.type === CommandType.Input &&
          lastCommand.inputType === 'deleteByDrag')
      ) {
        cancelAnimationFrame(inputQueueRequestRef.current!);
        inputQueueRef.current.push(command);
        flushInputQueue();
        return;
      }
    }
    inputQueueRef.current.push(command);
  }

  useEffect(() => {
    return () => {
      if (inputQueueRequestRef.current !== null) {
        clearTimeout(inputQueueRequestRef.current);
      }
    };
  }, []);

  const onHTMLSelectionChange = (event: Event): void => {
    if (isUpdatingSelection.current > 0) {
      return;
    }

    const { activeElement } = window.document;

    if (activeElement !== editorRef.current) {
      return;
    }

    const nativeSelection = window.getSelection()!;
    if (nativeSelection.rangeCount === 0) {
      return;
    }
    const curSelection = findSelection(
      editorCtrl.current.value,
      nativeSelection.getRangeAt(0),
      isSelectionBackwards(nativeSelection),
    );

    if (
      JSON.stringify(curSelection) !==
      JSON.stringify(editorCtrl.current.selection)
    ) {
      editorCtrl.current = pushState(
        editorCtrl.current,
        editorCtrl.current.value,
        curSelection,
        getSelectionTextStyle(editorCtrl.current.value, curSelection),
        PushStateAction.Selection,
      );
      setRenderToggle((t) => !t);
    }
  };

  function copySelection(value: EditorValue, selection: Selection): void {
    const curValue = extractSelection(value, selection);
    navigator.clipboard
      .write([
        new ClipboardItem({
          'text/plain': new Blob([extractText(curValue)], {
            type: 'text/plain',
          }),
          'text/html': new Blob(
            [
              renderToStaticMarkup(
                <>
                  <span data-matita={JSON.stringify(curValue)} />
                  <NumberedListIndicesContext.Provider
                    value={getListBlockIdToIdx(value)}
                  >
                    <ReactEditorValue value={curValue} />
                  </NumberedListIndicesContext.Provider>
                </>,
              ),
            ],
            { type: 'text/html' },
          ),
        }),
      ])
      .catch((error) => {
        console.error('error writing to clipboard', error);
      });
  }

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
    copySelection(editorCtrl.current.value, curSelection);
    event.preventDefault();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!editorCtrl.current.selection) {
      return;
    }
    for (let i = 0; i < cmds.length; i++) {
      const cmd = cmds[i];
      if (cmd.isKey(event)) {
        cmd
          .getCmds(editorCtrl.current.selection, editorCtrl.current.makeId)
          .forEach((command) => {
            queueCommand(command);
          });
      }
    }
  };

  useEffect(() => {
    const editorElement = editorRef.current!;
    window.document.addEventListener('selectionchange', onHTMLSelectionChange);
    editorElement.addEventListener('beforeinput', onBeforeInput);
    editorElement.addEventListener('copy', onCopy);
    editorElement.addEventListener('keydown', onKeyDown);
    return () => {
      window.document.removeEventListener(
        'selectionchange',
        onHTMLSelectionChange,
      );
      editorElement.removeEventListener('beforeinput', onBeforeInput);
      editorElement.removeEventListener('copy', onCopy);
      editorElement.removeEventListener('keydown', onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function getSelectedEditors(
    value: EditorValue,
    selection: Selection | null,
  ): string[] {
    if (!selection || isCollapsed(selection)) {
      return [];
    }
    const selected: string[] = [];
    if (
      selection.editorId === value.id &&
      selection.type === SelectionType.Block
    ) {
      const startBlockIndex = value.blocks.findIndex(
        (block) => block.id === selection.start.blockId,
      );
      const endBlockIndex = value.blocks.findIndex(
        (block) => block.id === selection.end.blockId,
      );
      value = makeEditorValue(
        value.blocks.slice(
          Math.min(startBlockIndex, endBlockIndex),
          Math.max(startBlockIndex, endBlockIndex) + 1,
        ),
        value.id,
      );
    }
    walkEditorValues(
      value,
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
          } else {
            return {
              stop: false,
              data: true,
              stopCur: true,
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
          } else {
            return {
              stop: false,
              data: true,
              stopCur: true,
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
  }

  function getListBlockIdToIdx(value: EditorValue): Record<string, number> {
    let listIdToCount: Record<string, number> = {};
    let listBlockIdToIdx: Record<string, number> = {};
    walkEditorValues(
      value,
      (_subValue, _data, _ids) => {
        return {
          stop: false,
          data: undefined,
        };
      },
      undefined,
      false,
      (block) => {
        if (
          !block.isBlock &&
          block.style.type === ParagraphStyleType.NumberedList
        ) {
          const { listId } = block.style;
          const blockId = block.id;
          let listIdx: number;
          if (listId in listIdToCount) {
            listIdx = listIdToCount[listId]++;
          } else {
            listIdx = 0;
            listIdToCount[listId] = 1;
          }
          listBlockIdToIdx[blockId] = listIdx;
        }
      },
    );
    return listBlockIdToIdx;
  }

  const [isClient, setIsClient] = useState(false);
  useEffect(() => {
    setIsClient(true);
  }, []);

  const onEditorToolbarMouseDown = (e: React.MouseEvent<HTMLElement>) => {
    e.preventDefault();
  };

  const selectedEditors_ = useMemo(
    () =>
      getSelectedEditors(
        editorCtrl.current.value,
        editorCtrl.current.selection,
      ),
    [editorCtrl.current.value, editorCtrl.current.selection],
  );
  const selectedEditors = useCustomCompareMemo(
    () => selectedEditors_,
    [selectedEditors_],
    (prev, cur) =>
      prev.length === cur.length && prev.every((v, i) => v === cur[i]),
  );

  const listBlockIdToIdx_ = useMemo(
    () => getListBlockIdToIdx(editorCtrl.current.value),
    [editorCtrl.current.value],
  );
  const listBlockIdToIdx = useCustomCompareMemo(
    () => listBlockIdToIdx_,
    [listBlockIdToIdx_],
    ([prev], [cur]) => {
      const pKeys = Object.keys(prev);
      return (
        pKeys.length === Object.keys(cur).length &&
        pKeys.every((k) => prev[k] === cur[k])
      );
    },
  );

  return (
    <>
      <div className="toolbar" onMouseDown={onEditorToolbarMouseDown}>
        {cmds
          .filter((cmd) => cmd.icon)
          .map((cmd) => {
            const isActive = editorCtrl.current.selection
              ? cmd.icon!.isActive(editorCtrl.current)
              : false;
            const Icon = cmd.icon!.Icon;
            const handle = () => {
              if (editorCtrl.current.selection) {
                cmd
                  .getCmds(
                    editorCtrl.current.selection,
                    editorCtrl.current.makeId,
                  )
                  .forEach((command) => {
                    queueCommand(command);
                  });
              }
            };
            return (
              <Tooltip info={cmd.icon!.name} key={cmd.icon!.name}>
                {({ focused }) => (
                  <Icon
                    onMouseDown={handle}
                    isActive={isActive}
                    isFocused={focused}
                  />
                )}
              </Tooltip>
            );
          })}
      </div>
      <div
        contentEditable={isClient}
        suppressContentEditableWarning
        ref={editorRef}
      >
        <SelectedEditorsContext.Provider value={selectedEditors}>
          <NumberedListIndicesContext.Provider value={listBlockIdToIdx}>
            <ReactEditorValue value={editorCtrl.current.value} />
          </NumberedListIndicesContext.Provider>
        </SelectedEditorsContext.Provider>
      </div>
    </>
  );
}

interface ToolbarIconProps extends React.SVGProps<SVGSVGElement> {
  isFocused?: boolean;
  isActive?: boolean;
}

function omit<T extends object, K extends string>(
  value: T,
  keys: K[],
): Omit<T, K> {
  const newValue: any = {};
  Object.keys(value).forEach((key) => {
    if (!keys.includes(key as unknown as any)) {
      newValue[key] = value[key as keyof T];
    }
  });
  return newValue;
}

function ToolbarIcon(props: ToolbarIconProps): JSX.Element {
  return (
    <svg
      {...omit(props, ['isFocused', 'isActive'])}
      className={[
        'toolbarIcon',
        props.isFocused && 'focusedToolbarIcon',
        props.isActive && 'activeToolbarIcon',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {props.children}
    </svg>
  );
}

function BoldIcon(props: ToolbarIconProps): JSX.Element {
  return (
    <ToolbarIcon
      version="1.1"
      width="11"
      height="14"
      viewBox="0 0 11 14"
      {...props}
    >
      <path d="M4.336 11.883q0.578 0.25 1.094 0.25 2.937 0 2.937-2.617 0-0.891-0.32-1.406-0.211-0.344-0.48-0.578t-0.527-0.363-0.629-0.195-0.656-0.082-0.738-0.016q-0.57 0-0.789 0.078 0 0.414-0.004 1.242t-0.004 1.234q0 0.062-0.008 0.527t-0.004 0.754 0.035 0.652 0.094 0.52zM4.227 6.055q0.328 0.055 0.852 0.055 0.641 0 1.117-0.102t0.859-0.348 0.582-0.699 0.199-1.109q0-0.547-0.227-0.957t-0.617-0.641-0.844-0.34-0.969-0.109q-0.391 0-1.016 0.102 0 0.391 0.031 1.18t0.031 1.187q0 0.211-0.004 0.625t-0.004 0.617q0 0.359 0.008 0.539zM0 13l0.016-0.734q0.117-0.031 0.664-0.125t0.828-0.211q0.055-0.094 0.098-0.211t0.066-0.262 0.043-0.254 0.023-0.293 0.004-0.266v-0.512q0-7.672-0.172-8.008-0.031-0.062-0.172-0.113t-0.348-0.086-0.387-0.055-0.379-0.035-0.238-0.023l-0.031-0.648q0.766-0.016 2.656-0.090t2.914-0.074q0.18 0 0.535 0.004t0.527 0.004q0.547 0 1.066 0.102t1.004 0.328 0.844 0.555 0.578 0.816 0.219 1.074q0 0.406-0.129 0.746t-0.305 0.563-0.504 0.449-0.57 0.352-0.656 0.312q1.203 0.273 2.004 1.047t0.801 1.937q0 0.781-0.273 1.402t-0.73 1.020-1.078 0.668-1.277 0.379-1.375 0.109q-0.344 0-1.031-0.023t-1.031-0.023q-0.828 0-2.398 0.086t-1.805 0.094z" />
    </ToolbarIcon>
  );
}

function ItalicIcon(props: ToolbarIconProps): JSX.Element {
  return (
    <ToolbarIcon
      version="1.1"
      width="8"
      height="14"
      viewBox="0 0 8 14"
      {...props}
    >
      <path d="M0 12.984l0.133-0.664q0.047-0.016 0.637-0.168t0.871-0.293q0.219-0.273 0.32-0.789 0.008-0.055 0.484-2.258t0.891-4.246 0.406-2.316v-0.195q-0.187-0.102-0.426-0.145t-0.543-0.062-0.453-0.043l0.148-0.805q0.258 0.016 0.937 0.051t1.168 0.055 0.941 0.020q0.375 0 0.77-0.020t0.945-0.055 0.77-0.051q-0.039 0.305-0.148 0.695-0.234 0.078-0.793 0.223t-0.848 0.262q-0.062 0.148-0.109 0.332t-0.070 0.312-0.059 0.355-0.051 0.328q-0.211 1.156-0.684 3.277t-0.605 2.777q-0.016 0.070-0.102 0.453t-0.156 0.703-0.125 0.652-0.047 0.449l0.008 0.141q0.133 0.031 1.445 0.242-0.023 0.344-0.125 0.773-0.086 0-0.254 0.012t-0.254 0.012q-0.227 0-0.68-0.078t-0.672-0.078q-1.078-0.016-1.609-0.016-0.398 0-1.117 0.070t-0.945 0.086z" />
    </ToolbarIcon>
  );
}

function UnderlineIcon(props: ToolbarIconProps): JSX.Element {
  return (
    <ToolbarIcon
      version="1.1"
      width="12"
      height="14"
      viewBox="0 0 12 14"
      {...props}
    >
      <path d="M0.375 1.742q-0.289-0.016-0.352-0.031l-0.023-0.688q0.102-0.008 0.312-0.008 0.469 0 0.875 0.031 1.031 0.055 1.297 0.055 0.672 0 1.313-0.023 0.906-0.031 1.141-0.039 0.438 0 0.672-0.016l-0.008 0.109 0.016 0.5v0.070q-0.469 0.070-0.969 0.070-0.469 0-0.617 0.195-0.102 0.109-0.102 1.031 0 0.102 0.004 0.254t0.004 0.199l0.008 1.789 0.109 2.188q0.047 0.969 0.398 1.578 0.273 0.461 0.75 0.719 0.688 0.367 1.383 0.367 0.813 0 1.492-0.219 0.438-0.141 0.773-0.398 0.375-0.281 0.508-0.5 0.281-0.438 0.414-0.891 0.164-0.57 0.164-1.789 0-0.617-0.027-1t-0.086-0.957-0.105-1.246l-0.031-0.461q-0.039-0.523-0.187-0.688-0.266-0.273-0.602-0.266l-0.781 0.016-0.109-0.023 0.016-0.672h0.656l1.602 0.078q0.594 0.023 1.531-0.078l0.141 0.016q0.047 0.297 0.047 0.398 0 0.055-0.031 0.242-0.352 0.094-0.656 0.102-0.57 0.086-0.617 0.133-0.117 0.117-0.117 0.32 0 0.055 0.012 0.211t0.012 0.242q0.062 0.148 0.172 3.094 0.047 1.523-0.117 2.375-0.117 0.594-0.32 0.953-0.297 0.508-0.875 0.961-0.586 0.445-1.422 0.695-0.852 0.258-1.992 0.258-1.305 0-2.219-0.359-0.93-0.367-1.398-0.953-0.477-0.594-0.648-1.523-0.125-0.625-0.125-1.852v-2.602q0-1.469-0.133-1.664-0.195-0.281-1.148-0.305zM12 12.75v-0.5q0-0.109-0.070-0.18t-0.18-0.070h-11.5q-0.109 0-0.18 0.070t-0.070 0.18v0.5q0 0.109 0.070 0.18t0.18 0.070h11.5q0.109 0 0.18-0.070t0.070-0.18z" />
    </ToolbarIcon>
  );
}

function InlineCodeIcon(props: ToolbarIconProps): JSX.Element {
  return (
    <ToolbarIcon
      version="1.1"
      width="12"
      height="14"
      viewBox="0 0 640 512"
      {...props}
    >
      <path d="M392.8 1.2c-17-4.9-34.7 5-39.6 22l-128 448c-4.9 17 5 34.7 22 39.6s34.7-5 39.6-22l128-448c4.9-17-5-34.7-22-39.6zm80.6 120.1c-12.5 12.5-12.5 32.8 0 45.3L562.7 256l-89.4 89.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0l112-112c12.5-12.5 12.5-32.8 0-45.3l-112-112c-12.5-12.5-32.8-12.5-45.3 0zm-306.7 0c-12.5-12.5-32.8-12.5-45.3 0l-112 112c-12.5 12.5-12.5 32.8 0 45.3l112 112c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L77.3 256l89.4-89.4c12.5-12.5 12.5-32.8 0-45.3z" />
    </ToolbarIcon>
  );
}

function StrikethroughIcon(props: ToolbarIconProps): JSX.Element {
  return (
    <ToolbarIcon
      version="1.1"
      width="12"
      height="14"
      viewBox="0 0 512 512"
      {...props}
    >
      <path
        xmlns="http://www.w3.org/2000/svg"
        d="M161.3 144c3.2-17.2 14-30.1 33.7-38.6c21.1-9 51.8-12.3 88.6-6.5c11.9 1.9 48.8 9.1 60.1 12c17.1 4.5 34.6-5.6 39.2-22.7s-5.6-34.6-22.7-39.2c-14.3-3.8-53.6-11.4-66.6-13.4c-44.7-7-88.3-4.2-123.7 10.9c-36.5 15.6-64.4 44.8-71.8 87.3c-.1 .6-.2 1.1-.2 1.7c-2.8 23.9 .5 45.6 10.1 64.6c4.5 9 10.2 16.9 16.7 23.9H32c-17.7 0-32 14.3-32 32s14.3 32 32 32H480c17.7 0 32-14.3 32-32s-14.3-32-32-32H270.1c-.1 0-.3-.1-.4-.1l-1.1-.3c-36-10.8-65.2-19.6-85.2-33.1c-9.3-6.3-15-12.6-18.2-19.1c-3.1-6.1-5.2-14.6-3.8-27.4zM348.9 337.2c2.7 6.5 4.4 15.8 1.9 30.1c-3 17.6-13.8 30.8-33.9 39.4c-21.1 9-51.7 12.3-88.5 6.5c-18-2.9-49.1-13.5-74.4-22.1c-5.6-1.9-11-3.7-15.9-5.4c-16.8-5.6-34.9 3.5-40.5 20.3s3.5 34.9 20.3 40.5c3.6 1.2 7.9 2.7 12.7 4.3l0 0 0 0c24.9 8.5 63.6 21.7 87.6 25.6l0 0 .2 0c44.7 7 88.3 4.2 123.7-10.9c36.5-15.6 64.4-44.8 71.8-87.3c3.6-21 2.7-40.4-3.1-58.1H335.1c7 5.6 11.4 11.2 13.9 17.2z"
      />
    </ToolbarIcon>
  );
}

function SuperscriptIcon(props: ToolbarIconProps): JSX.Element {
  return (
    <ToolbarIcon
      version="1.1"
      width="12"
      height="14"
      viewBox="0 0 512 512"
      {...props}
    >
      <path d="M480 32c0-11.1-5.7-21.4-15.2-27.2s-21.2-6.4-31.1-1.4l-32 16c-15.8 7.9-22.2 27.1-14.3 42.9C393 73.5 404.3 80 416 80v80c-17.7 0-32 14.3-32 32s14.3 32 32 32h32 32c17.7 0 32-14.3 32-32s-14.3-32-32-32V32zM32 64C14.3 64 0 78.3 0 96s14.3 32 32 32H47.3l89.6 128L47.3 384H32c-17.7 0-32 14.3-32 32s14.3 32 32 32H64c10.4 0 20.2-5.1 26.2-13.6L176 311.8l85.8 122.6c6 8.6 15.8 13.6 26.2 13.6h32c17.7 0 32-14.3 32-32s-14.3-32-32-32H304.7L215.1 256l89.6-128H320c17.7 0 32-14.3 32-32s-14.3-32-32-32H288c-10.4 0-20.2 5.1-26.2 13.6L176 200.2 90.2 77.6C84.2 69.1 74.4 64 64 64H32z" />
    </ToolbarIcon>
  );
}

function SubscriptIcon(props: ToolbarIconProps): JSX.Element {
  return (
    <ToolbarIcon
      version="1.1"
      width="12"
      height="14"
      viewBox="0 0 512 512"
      {...props}
    >
      <path d="M32 64C14.3 64 0 78.3 0 96s14.3 32 32 32H47.3l89.6 128L47.3 384H32c-17.7 0-32 14.3-32 32s14.3 32 32 32H64c10.4 0 20.2-5.1 26.2-13.6L176 311.8l85.8 122.6c6 8.6 15.8 13.6 26.2 13.6h32c17.7 0 32-14.3 32-32s-14.3-32-32-32H304.7L215.1 256l89.6-128H320c17.7 0 32-14.3 32-32s-14.3-32-32-32H288c-10.4 0-20.2 5.1-26.2 13.6L176 200.2 90.2 77.6C84.2 69.1 74.4 64 64 64H32zM480 320c0-11.1-5.7-21.4-15.2-27.2s-21.2-6.4-31.1-1.4l-32 16c-15.8 7.9-22.2 27.1-14.3 42.9C393 361.5 404.3 368 416 368v80c-17.7 0-32 14.3-32 32s14.3 32 32 32h32 32c17.7 0 32-14.3 32-32s-14.3-32-32-32V320z" />
    </ToolbarIcon>
  );
}

function TitleIcon(props: ToolbarIconProps): JSX.Element {
  return (
    <ToolbarIcon
      version="1.1"
      width="12"
      height="14"
      viewBox="0 0 448 512"
      {...props}
    >
      <path d="M0 64C0 46.3 14.3 32 32 32H80h48c17.7 0 32 14.3 32 32s-14.3 32-32 32H112V208H336V96H320c-17.7 0-32-14.3-32-32s14.3-32 32-32h48 48c17.7 0 32 14.3 32 32s-14.3 32-32 32H400V240 416h16c17.7 0 32 14.3 32 32s-14.3 32-32 32H368 320c-17.7 0-32-14.3-32-32s14.3-32 32-32h16V272H112V416h16c17.7 0 32 14.3 32 32s-14.3 32-32 32H80 32c-17.7 0-32-14.3-32-32s14.3-32 32-32H48V240 96H32C14.3 96 0 81.7 0 64z" />
    </ToolbarIcon>
  );
}

function SubtitleIcon(props: ToolbarIconProps): JSX.Element {
  return (
    <ToolbarIcon
      version="1.1"
      width="12"
      height="14"
      viewBox="0 0 384 512"
      {...props}
    >
      <path d="M32 32C14.3 32 0 46.3 0 64S14.3 96 32 96H160V448c0 17.7 14.3 32 32 32s32-14.3 32-32V96H352c17.7 0 32-14.3 32-32s-14.3-32-32-32H192 32z" />
    </ToolbarIcon>
  );
}

function CodeBlockIcon(props: ToolbarIconProps): JSX.Element {
  return (
    <ToolbarIcon
      version="1.1"
      width="12"
      height="14"
      viewBox="0 0 640 512"
      {...props}
    >
      <path d="M392.8 1.2c-17-4.9-34.7 5-39.6 22l-128 448c-4.9 17 5 34.7 22 39.6s34.7-5 39.6-22l128-448c4.9-17-5-34.7-22-39.6zm80.6 120.1c-12.5 12.5-12.5 32.8 0 45.3L562.7 256l-89.4 89.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0l112-112c12.5-12.5 12.5-32.8 0-45.3l-112-112c-12.5-12.5-32.8-12.5-45.3 0zm-306.7 0c-12.5-12.5-32.8-12.5-45.3 0l-112 112c-12.5 12.5-12.5 32.8 0 45.3l112 112c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L77.3 256l89.4-89.4c12.5-12.5 12.5-32.8 0-45.3z" />
    </ToolbarIcon>
  );
}

function QuoteIcon(props: ToolbarIconProps): JSX.Element {
  return (
    <ToolbarIcon
      version="1.1"
      width="12"
      height="14"
      viewBox="0 0 448 512"
      {...props}
    >
      <path d="M448 296c0 66.3-53.7 120-120 120h-8c-17.7 0-32-14.3-32-32s14.3-32 32-32h8c30.9 0 56-25.1 56-56v-8H320c-35.3 0-64-28.7-64-64V160c0-35.3 28.7-64 64-64h64c35.3 0 64 28.7 64 64v32 32 72zm-256 0c0 66.3-53.7 120-120 120H64c-17.7 0-32-14.3-32-32s14.3-32 32-32h8c30.9 0 56-25.1 56-56v-8H64c-35.3 0-64-28.7-64-64V160c0-35.3 28.7-64 64-64h64c35.3 0 64 28.7 64 64v32 32 72z" />
    </ToolbarIcon>
  );
}

function PullQuoteIcon(props: ToolbarIconProps): JSX.Element {
  return (
    <ToolbarIcon
      version="1.1"
      width="12"
      height="14"
      viewBox="0 0 512 512"
      {...props}
    >
      <path d="M470.6 278.6c12.5-12.5 12.5-32.8 0-45.3l-160-160c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L402.7 256 265.4 393.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0l160-160zm-352 160l160-160c12.5-12.5 12.5-32.8 0-45.3l-160-160c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L210.7 256 73.4 393.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0z" />
    </ToolbarIcon>
  );
}

function BulletListIcon(props: ToolbarIconProps): JSX.Element {
  return (
    <ToolbarIcon
      version="1.1"
      width="12"
      height="14"
      viewBox="0 0 512 512"
      {...props}
    >
      <path d="M40 48C26.7 48 16 58.7 16 72v48c0 13.3 10.7 24 24 24H88c13.3 0 24-10.7 24-24V72c0-13.3-10.7-24-24-24H40zM192 64c-17.7 0-32 14.3-32 32s14.3 32 32 32H480c17.7 0 32-14.3 32-32s-14.3-32-32-32H192zm0 160c-17.7 0-32 14.3-32 32s14.3 32 32 32H480c17.7 0 32-14.3 32-32s-14.3-32-32-32H192zm0 160c-17.7 0-32 14.3-32 32s14.3 32 32 32H480c17.7 0 32-14.3 32-32s-14.3-32-32-32H192zM16 232v48c0 13.3 10.7 24 24 24H88c13.3 0 24-10.7 24-24V232c0-13.3-10.7-24-24-24H40c-13.3 0-24 10.7-24 24zM40 368c-13.3 0-24 10.7-24 24v48c0 13.3 10.7 24 24 24H88c13.3 0 24-10.7 24-24V392c0-13.3-10.7-24-24-24H40z" />
    </ToolbarIcon>
  );
}

function NumberedListIcon(props: ToolbarIconProps): JSX.Element {
  return (
    <ToolbarIcon
      version="1.1"
      width="12"
      height="14"
      viewBox="0 0 215 197"
      {...props}
    >
      <g
        xmlns="http://www.w3.org/2000/svg"
        transform="translate(0.000000,197.000000) scale(0.100000,-0.100000)"
        fill="#000000"
        stroke="none"
      >
        <path d="M229 1815 c-14 -8 -32 -28 -39 -45 -11 -27 -11 -37 3 -66 13 -27 26 -36 62 -46 l45 -12 0 -178 0 -178 -30 0 c-85 0 -134 -58 -106 -125 20 -46 55 -55 226 -55 171 0 206 9 226 55 27 66 -20 125 -101 125 l-35 0 0 230 c0 248 -4 271 -51 296 -37 18 -165 18 -200 -1z" />
        <path d="M873 1694 c-90 -45 -73 -189 25 -212 20 -5 261 -8 534 -8 489 1 497 1 525 22 34 25 58 83 49 119 -4 14 -19 40 -35 58 l-29 32 -519 2 c-455 3 -522 1 -550 -13z" />
        <path d="M873 1094 c-33 -16 -63 -66 -63 -104 0 -34 28 -79 63 -100 31 -19 54 -20 532 -20 562 0 552 -1 588 72 24 48 15 97 -25 135 l-29 28 -517 2 c-455 3 -521 1 -549 -13z" />
        <path d="M296 854 c-83 -26 -186 -152 -172 -210 10 -40 42 -64 84 -64 44 0 46 2 95 63 42 51 80 62 111 31 33 -33 20 -61 -86 -176 -57 -62 -124 -135 -150 -163 -26 -28 -50 -63 -53 -77 -9 -37 18 -84 56 -97 48 -17 351 -14 393 3 67 28 68 124 1 154 -14 7 -55 12 -90 12 -36 0 -65 3 -65 6 0 3 33 41 73 85 93 103 110 136 110 215 0 50 -6 72 -27 109 -34 58 -93 100 -157 114 -61 13 -62 13 -123 -5z" />
        <path d="M890 503 c-31 -11 -70 -58 -76 -90 -7 -40 8 -82 43 -115 l25 -23 508 -3 c556 -3 559 -3 597 54 11 17 18 45 17 72 -1 35 -7 50 -33 75 l-31 32 -518 2 c-284 1 -524 -1 -532 -4z" />
      </g>
    </ToolbarIcon>
  );
}

export default function Home() {
  let id_ = 0;
  function id(): string {
    return String(id_++);
  }

  // prettier-ignore
  const initialValue = makeEditorValue([makeTitleParagraph([makeDefaultText("This is the title",id())],id()),makeTable([makeTableRow([makeTableCell(makeEditorValue([makeDefaultParagraph([makeText("Song",{bold:true},id()),],id()),],id()),id()),makeTableCell(makeEditorValue([makeDefaultParagraph([makeText("Scrobbles",{bold:true},id()),],id()),],id()),id()),],id()),makeTableRow([makeTableCell(makeEditorValue([makeDefaultParagraph([makeDefaultText("Nikes",id())],id()),],id()),id()),makeTableCell(makeEditorValue([makeDefaultParagraph([makeDefaultText("73",id())],id()),makeTable([makeTableRow([makeTableCell(makeEditorValue([makeDefaultParagraph([makeText("Song",{bold:true},id()),],id()),],id()),id()),makeTableCell(makeEditorValue([makeDefaultParagraph([makeText("Scrobbles",{bold:true},id()),],id()),],id()),id()),],id()),makeTableRow([makeTableCell(makeEditorValue([makeDefaultParagraph([makeDefaultText("Nikes",id())],id()),makeTable([makeTableRow([makeTableCell(makeEditorValue([makeDefaultParagraph([makeText("Song",{bold:true},id()),],id()),],id()),id()),makeTableCell(makeEditorValue([makeDefaultParagraph([makeText("Scrobbles",{bold:true},id()),],id()),],id()),id()),],id()),makeTableRow([makeTableCell(makeEditorValue([makeDefaultParagraph([makeDefaultText("Nikes",id()),],id()),],id()),id()),makeTableCell(makeEditorValue([makeDefaultParagraph([makeDefaultText("73",id())],id()),],id()),id()),],id()),makeTableRow([makeTableCell(makeEditorValue([makeDefaultParagraph([makeDefaultText("Valuable Pain",id()),],id()),],id()),id()),makeTableCell(makeEditorValue([makeDefaultParagraph([makeDefaultText("223",id()),],id()),makeDefaultParagraph([makeDefaultText("223",id()),],id()),makeTable([makeTableRow([makeTableCell(makeEditorValue([makeDefaultParagraph([makeText("Song",{bold:true},id()),],id()),makeTable([makeTableRow([makeTableCell(makeEditorValue([makeDefaultParagraph([makeText("Song",{bold:true},id()),],id()),],id()),id()),makeTableCell(makeEditorValue([makeDefaultParagraph([makeText("Scrobbles",{bold:true},id()),],id()),],id()),id()),],id()),makeTableRow([makeTableCell(makeEditorValue([makeDefaultParagraph([makeDefaultText("Nikes",id()),],id()),],id()),id()),makeTableCell(makeEditorValue([makeDefaultParagraph([makeDefaultText("73",id()),],id()),],id()),id()),],id()),makeTableRow([makeTableCell(makeEditorValue([makeDefaultParagraph([makeDefaultText("Valuable Pain",id()),],id()),],id()),id()),makeTableCell(makeEditorValue([makeDefaultParagraph([makeDefaultText("223",id()),],id()),],id()),id()),],id()),],2,id()),makeDefaultParagraph([makeDefaultText("1",id()),],id()),makeTable([makeTableRow([makeTableCell(makeEditorValue([makeDefaultParagraph([makeText("Song",{bold:true},id()),],id()),],id()),id()),makeTableCell(makeEditorValue([makeDefaultParagraph([makeText("Scrobbles",{bold:true},id()),],id()),],id()),id()),],id()),makeTableRow([makeTableCell(makeEditorValue([makeDefaultParagraph([makeDefaultText("Nikes",id()),],id()),],id()),id()),makeTableCell(makeEditorValue([makeDefaultParagraph([makeDefaultText("73",id()),],id()),],id()),id()),],id()),makeTableRow([makeTableCell(makeEditorValue([makeDefaultParagraph([makeDefaultText("Valuable Pain",id()),],id()),],id()),id()),makeTableCell(makeEditorValue([makeDefaultParagraph([makeDefaultText("223",id()),],id()),],id()),id()),],id()),],2,id()),],id()),id()),makeTableCell(makeEditorValue([makeDefaultParagraph([makeText("Scrobbles",{bold:true},id()),],id()),],id()),id()),],id()),makeTableRow([makeTableCell(makeEditorValue([makeDefaultParagraph([makeDefaultText("Nikes",id()),],id()),],id()),id()),makeTableCell(makeEditorValue([makeDefaultParagraph([makeDefaultText("73",id()),],id()),],id()),id()),],id()),makeTableRow([makeTableCell(makeEditorValue([makeDefaultParagraph([makeDefaultText("Valuable Pain",id()),],id()),],id()),id()),makeTableCell(makeEditorValue([makeDefaultParagraph([makeDefaultText("223",id()),],id()),],id()),id()),],id()),],2,id()),makeDefaultParagraph([makeDefaultText("1",id())],id()),makeTable([makeTableRow([makeTableCell(makeEditorValue([makeDefaultParagraph([makeText("Song",{bold:true},id()),],id()),],id()),id()),makeTableCell(makeEditorValue([makeDefaultParagraph([makeText("Scrobbles",{bold:true},id()),],id()),],id()),id()),],id()),makeTableRow([makeTableCell(makeEditorValue([makeDefaultParagraph([makeDefaultText("Nikes",id()),],id()),],id()),id()),makeTableCell(makeEditorValue([makeDefaultParagraph([makeDefaultText("73",id()),],id()),],id()),id()),],id()),makeTableRow([makeTableCell(makeEditorValue([makeDefaultParagraph([makeDefaultText("Valuable Pain",id()),],id()),],id()),id()),makeTableCell(makeEditorValue([makeDefaultParagraph([makeDefaultText("223",id()),],id()),],id()),id()),],id()),],2,id()),makeDefaultParagraph([makeDefaultText("223",id()),],id()),],id()),id()),],id()),],2,id()),],id()),id()),makeTableCell(makeEditorValue([makeDefaultParagraph([makeDefaultText("73",id())],id()),],id()),id()),],id()),makeTableRow([makeTableCell(makeEditorValue([makeDefaultParagraph([makeDefaultText("Valuable Pain",id())],id()),],id()),id()),makeTableCell(makeEditorValue([makeDefaultParagraph([makeDefaultText("223",id())],id()),],id()),id()),],id()),],2,id()),],id()),id()),],id()),makeTableRow([makeTableCell(makeEditorValue([makeDefaultParagraph([makeDefaultText("Valuable Pain",id())],id()),],id()),id()),makeTableCell(makeEditorValue([makeDefaultParagraph([makeDefaultText("223",id())],id())],id()),id()),],id()),],2,id()),makeNumberedListParagraph([makeDefaultText("Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry's standard dummy text ever since the 1500s, when an unknown printer took a galley of type and scrambled it to make a type specimen book. It has survived not only five centuries, but also the leap into electronic typesetting, remaining essentially unchanged. It was popularised in the 1960s with the release of Letraset sheets containing Lorem Ipsum passages, and more recently with desktop publishing software like Aldus PageMaker including versions of Lorem Ipsum.",id()),],id(),id()),makeDefaultParagraph([makeDefaultText("",id())],id()),makeDefaultParagraph([makeDefaultText("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",id()),],id())],id())

  return (
    <main className={['markdown-body', roboto.className].join(' ')}>
      <ReactEditor initialValue={initialValue} makeId={id} />
    </main>
  );
}
