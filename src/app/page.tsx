'use client';
import React, {
  cloneElement,
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Roboto } from '@next/font/google';
import { Tooltip } from '@/Tooltip';
import { createDraft, finishDraft } from 'immer';
import { WritableDraft } from 'immer/dist/internal';
import { flushSync } from 'react-dom';
import MonacoEditor, { loader } from '@monaco-editor/react';
import monacoTheme from './monacoTheme.json';

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
  Code = 'Block/Code',
  Paragraph = 'Block/Paragraph',
}

enum InlineNodeType {
  Text = 'Inline/Text',
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

interface CodeBlockNode {
  type: BlockNodeType.Code;
  isBlock: true;
  code: string;
  language?: string;
  id: string;
}

enum ParagraphStyleType {
  Default = 'Default',
  Heading2 = 'Heading 2',
  Heading1 = 'Heading 1',
  Heading3 = 'Heading 3',
  Quote = 'Quote',
  BulletList = 'Bullet List',
  NumberedList = 'Numbered List',
}

enum TextAlign {
  Left = 'Left',
  Center = 'Center',
  Right = 'Right',
  Justify = 'Justify',
}

const MAX_INDENT = 8;
interface ParagraphStyleBase {
  align?: TextAlign;
  indentLevel?: number;
  hangingIndent?: boolean;
}

interface DefaultParagraphStyle extends ParagraphStyleBase {
  type: ParagraphStyleType.Default;
}
interface Heading2ParagraphStyle extends ParagraphStyleBase {
  type: ParagraphStyleType.Heading2;
}
interface Heading1ParagraphStyle extends ParagraphStyleBase {
  type: ParagraphStyleType.Heading1;
}
interface Heading3ParagraphStyle extends ParagraphStyleBase {
  type: ParagraphStyleType.Heading3;
}
interface QuoteParagraphStyle extends ParagraphStyleBase {
  type: ParagraphStyleType.Quote;
}
interface BulletListParagraphStyle extends ParagraphStyleBase {
  type: ParagraphStyleType.BulletList;
  listId: string;
}
interface NumberedListParagraphStyle extends ParagraphStyleBase {
  type: ParagraphStyleType.NumberedList;
  listId: string;
}

type ParagraphStyle =
  | DefaultParagraphStyle
  | Heading2ParagraphStyle
  | Heading1ParagraphStyle
  | Heading3ParagraphStyle
  | QuoteParagraphStyle
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

interface Link {
  href: string;
}

interface TextStyle {
  bold?: true;
  italic?: true;
  underline?: true;
  code?: true;
  strikethrough?: true;
  script?: TextScript;
  link?: Link;
}

interface TextNode {
  type: InlineNodeType.Text;
  isBlock: false;
  text: string;
  style: TextStyle;
  id: string;
}

type BlockNode = ImageNode | TableNode | CodeBlockNode | ParagraphNode;
type InlineNode = TextNode;

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
  lastAction: PushStateAction | string;
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
  styleBase?: ParagraphStyleBase,
): ParagraphNode {
  return makeParagraph(
    children,
    { type: ParagraphStyleType.Default, ...styleBase },
    id,
  );
}
function makeHeading2Paragraph(
  children: InlineNode[],
  id: string,
  styleBase?: ParagraphStyleBase,
): ParagraphNode {
  return makeParagraph(
    children,
    { type: ParagraphStyleType.Heading2, ...styleBase },
    id,
  );
}
function makeHeading1Paragraph(
  children: InlineNode[],
  id: string,
  styleBase?: ParagraphStyleBase,
): ParagraphNode {
  return makeParagraph(
    children,
    { type: ParagraphStyleType.Heading1, ...styleBase },
    id,
  );
}
function makeHeading3Paragraph(
  children: InlineNode[],
  id: string,
  styleBase?: ParagraphStyleBase,
): ParagraphNode {
  return makeParagraph(
    children,
    { type: ParagraphStyleType.Heading3, ...styleBase },
    id,
  );
}
function makeQuoteParagraph(
  children: InlineNode[],
  id: string,
  styleBase?: ParagraphStyleBase,
): ParagraphNode {
  return makeParagraph(
    children,
    { type: ParagraphStyleType.Quote, ...styleBase },
    id,
  );
}
function makeBulletListParagraph(
  children: InlineNode[],
  listId: string,
  id: string,
  styleBase?: ParagraphStyleBase,
): ParagraphNode {
  return makeParagraph(
    children,
    { type: ParagraphStyleType.BulletList, listId, ...styleBase },
    id,
  );
}
function makeNumberedListParagraph(
  children: InlineNode[],
  listId: string,
  id: string,
  styleBase?: ParagraphStyleBase,
): ParagraphNode {
  return makeParagraph(
    children,
    { type: ParagraphStyleType.NumberedList, listId, ...styleBase },
    id,
  );
}

function makeCodeBlock(
  code: string,
  language: string | undefined,
  id: string,
): CodeBlockNode {
  return {
    type: BlockNodeType.Code,
    isBlock: true,
    code,
    language,
    id,
  };
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
  queueCommand: (cmd: Command) => void;
}
function ReactTableNode_({
  value,
  selectedCells,
  queueCommand,
}: ReactTableNodeProps & { selectedCells: string[] }): JSX.Element {
  return (
    <div className="table-div">
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
                      <ReactEditorValue
                        value={cell.value}
                        queueCommand={queueCommand}
                      />
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
function ReactTableNode({
  value,
  queueCommand,
}: ReactTableNodeProps): JSX.Element {
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
  return (
    <ReactTableNode_m
      value={value}
      queueCommand={queueCommand}
      selectedCells={selectedCells}
    />
  );
}

function ReactBlockImageNode_({ value }: { value: ImageNode }): JSX.Element {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      data-family={EditorFamilyType.Block}
      data-type={BlockNodeType.Image}
      data-id={value.id}
      src={value.src}
      alt={value.caption}
    />
  );
}
const ReactBlockImageNode = memo(ReactBlockImageNode_);

function ReactCodeBlockNode({
  value,
  editorId,
  queueCommand,
}: {
  value: CodeBlockNode;
  editorId: string;
  queueCommand: (cmd: Command) => void;
}): JSX.Element {
  let editorRef =
    useRef<
      import('monaco-editor/esm/vs/editor/editor.api.js').editor.IStandaloneCodeEditor
    >();
  const [height, setHeight] = useState(0);
  const callback = useRef<any>();
  callback.current = (code: string) => {
    console.log({ code, valueCode: value.code });
    if (code === value.code) {
      return;
    }
    queueCommand({
      type: CommandType.Input,
      selection: {
        type: SelectionType.Block,
        editorId,
        start: {
          type: BlockSelectionPointType.OtherBlock,
          blockId: value.id,
        },
        end: {
          type: BlockSelectionPointType.OtherBlock,
          blockId: value.id,
        },
      },
      inputType: 'x_ReplaceBlock_MergeHistory',
      data: {
        type: DataTransferType.Rich,
        value: makeEditorValue(
          [makeCodeBlock(code || '', value.language, value.id)],
          '',
        ),
      },
    });
  };
  const [isClient, setIsClient] = useState(false);
  useEffect(() => {
    setIsClient(true);
  }, []);
  return (
    <div
      className="code-block"
      contentEditable={false}
      data-family={EditorFamilyType.Block}
      data-type={BlockNodeType.Code}
      data-id={value.id}
    >
      {isClient && (
        <MonacoEditor
          language={value.language || 'typescript'}
          value={value.code}
          height={height}
          options={{
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            wrappingStrategy: 'advanced',
            minimap: {
              enabled: false,
            },
            overviewRulerLanes: 0,
            renderWhitespace: 'none',
            guides: {
              indentation: false,
            },
          }}
          theme={'my-theme'}
          onMount={(editor) => {
            editorRef.current = editor;
            setHeight(editor.getContentHeight());
            editor.onDidContentSizeChange(() => {
              const contentHeight = editor.getContentHeight();
              setHeight(contentHeight);
            });
          }}
          onChange={(code) => callback.current(code)}
        />
      )}
    </div>
  );
}

if (typeof window !== 'undefined') {
  loader.init().then((monaco) => {
    monaco.editor.defineTheme('my-theme', monacoTheme as any);
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.Latest,
      allowNonTsExtensions: true,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      module: monaco.languages.typescript.ModuleKind.CommonJS,
      noEmit: true,
      esModuleInterop: true,
      jsx: monaco.languages.typescript.JsxEmit.React,
      reactNamespace: 'React',
      allowJs: true,
      typeRoots: ['node_modules/@types'],
    });
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: true,
    });
    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      '<<react-definition-file>>',
      `file:///node_modules/@react/types/index.d.ts`,
    );
  });
}

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
  let children: JSX.Element | JSX.Element[];
  if (isEmpty) {
    children = <br />;
  } else {
    children = [];
    let i = 0;
    groupArr(
      value.children,
      (inline) => {
        if (!inline.isBlock && inline.style.link) {
          return { link: inline.style.link };
        }
        return null;
      },
      (a, b) => a === b || !!(a && b && a.link.href === b.link.href),
    ).forEach((group) => {
      const texts = group.items.map((inline) => {
        switch (inline.type) {
          case InlineNodeType.Text: {
            const i_ = i++;
            if (inline.style.code) {
              const prevChild = i_ === 0 ? null : value.children[i_ - 1];
              const nextChild =
                i_ === value.children.length - 1
                  ? null
                  : value.children[i_ + 1];
              const isFirst =
                !prevChild || (!prevChild.isBlock && !prevChild.style.code);
              const isLast =
                !nextChild || (!nextChild.isBlock && !nextChild.style.code);
              return (
                <ReactTextNode
                  value={inline}
                  isFirstCode={isFirst}
                  isLastCode={isLast}
                  key={inline.id}
                />
              );
            }
            return <ReactTextNode value={inline} key={inline.id} />;
          }
        }
      });
      if (group.groupInfo) {
        (children as JSX.Element[]).push(
          <a href={group.groupInfo.link.href} key={group.items[0].id}>
            {texts}
          </a>,
        );
        return;
      }
      (children as JSX.Element[]).push(...texts);
    });
  }
  let style: React.CSSProperties = {
    textAlign:
      value.style.align === TextAlign.Left
        ? 'left'
        : value.style.align === TextAlign.Right
        ? 'right'
        : value.style.align === TextAlign.Center
        ? 'center'
        : value.style.align === TextAlign.Justify
        ? 'justify'
        : undefined,
    marginLeft: value.style.indentLevel && `${value.style.indentLevel * 2}em`,
  };
  switch (value.style.type) {
    case ParagraphStyleType.Default: {
      return (
        <p
          style={style}
          data-family={EditorFamilyType.Block}
          data-type={BlockNodeType.Paragraph}
          data-empty-paragraph={isEmpty}
          data-id={value.id}
        >
          {children}
        </p>
      );
    }
    case ParagraphStyleType.Heading2: {
      return (
        <h2
          style={style}
          data-family={EditorFamilyType.Block}
          data-type={BlockNodeType.Paragraph}
          data-empty-paragraph={isEmpty}
          data-id={value.id}
        >
          {children}
        </h2>
      );
    }
    case ParagraphStyleType.Heading1: {
      return (
        <h1
          style={style}
          data-family={EditorFamilyType.Block}
          data-type={BlockNodeType.Paragraph}
          data-empty-paragraph={isEmpty}
          data-id={value.id}
        >
          {children}
        </h1>
      );
    }
    case ParagraphStyleType.Heading3: {
      return (
        <h3
          style={style}
          data-family={EditorFamilyType.Block}
          data-type={BlockNodeType.Paragraph}
          data-empty-paragraph={isEmpty}
          data-id={value.id}
        >
          {children}
        </h3>
      );
    }
    case ParagraphStyleType.Quote: {
      return (
        <blockquote
          style={style}
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
          style={omit(style, ['marginLeft'])}
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
          style={omit(style, ['marginLeft'])}
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

function ReactTextNode({
  value,
  isFirstCode,
  isLastCode,
}: {
  value: TextNode;
  isFirstCode?: boolean;
  isLastCode?: boolean;
}): JSX.Element {
  function renderText(
    textValue: string,
    isFirst?: boolean,
    isLast?: boolean,
    key?: React.Key,
    start?: number,
  ): JSX.Element {
    let text: JSX.Element | string = textValue;
    if (value.style.bold) {
      text = <b>{text}</b>;
    }
    if (value.style.italic) {
      text = <i>{text}</i>;
    }
    if (value.style.underline) {
      text = <u>{text}</u>;
    }
    if (value.style.strikethrough) {
      text = <s>{text}</s>;
    }
    if (value.style.code) {
      text = (
        <code
          className={[
            isFirst && isFirstCode && 'code-first',
            isLast && isLastCode && 'code-last',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {text}
        </code>
      );
    }
    if (value.style.script === TextScript.Superscript) {
      text = <sup>{text}</sup>;
    }
    if (value.style.script === TextScript.Subscript) {
      text = <sub>{text}</sub>;
    }
    if (typeof text !== 'string' && !Array.isArray(text)) {
      return cloneElement(text, {
        className:
          'inline-text' +
          (text.props.className ? ' ' + text.props.className : ''),
        'data-family': EditorFamilyType.Inline,
        'data-type': InlineNodeType.Text,
        'data-paragraph-offset-start': start,
        'data-id': value.id,
        key,
      });
    }
    return (
      <span
        className="inline-text"
        data-family={EditorFamilyType.Inline}
        data-type={InlineNodeType.Text}
        data-paragraph-offset-start={start}
        data-id={value.id}
        key={key}
      >
        {text}
      </span>
    );
  }
  return renderText(value.text, true, true);
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
  queueCommand: (cmd: Command) => void;
}
function ReactEditorValue_({
  value,
  listBlockIdToIdx,
  queueCommand,
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
        return {
          listType: block.style.type,
          listId: block.style.listId,
          indent: block.style.indentLevel || 0,
        };
      }
      return null;
    },
    (a, b) =>
      a === b ||
      (a !== null &&
        b !== null &&
        a.listId === b.listId &&
        a.indent === b.indent),
  ).forEach((group) => {
    const { groupInfo } = group;
    if (groupInfo !== null) {
      const { listType, indent } = groupInfo;
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
          <ol
            key={items[0].id}
            start={listBlockIdToIdx[items[0].id] + 1}
            style={{ paddingLeft: `${(indent + 1) * 2}em` }}
          >
            {listNodes}
          </ol>,
        );
      } else {
        children.push(
          <ul
            key={items[0].id}
            style={{ paddingLeft: `${(indent + 1) * 2}em` }}
          >
            {listNodes}
          </ul>,
        );
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
          children.push(
            <ReactTableNode
              value={block}
              queueCommand={queueCommand}
              key={block.id}
            />,
          );
          break;
        }
        case BlockNodeType.Code: {
          children.push(
            <ReactCodeBlockNode
              value={block}
              editorId={value.id}
              queueCommand={queueCommand}
              key={block.id}
            />,
          );
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
function ReactEditorValue({
  value,
  queueCommand,
}: ReactEditorValueProps): JSX.Element {
  const listBlockIdToIdx = useContext(NumberedListIndicesContext);
  return (
    <ReactEditorValue_m
      value={value}
      queueCommand={queueCommand}
      listBlockIdToIdx={listBlockIdToIdx}
    />
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
    const startAttr = nearestDocNode.getAttribute(
      'data-paragraph-offset-start',
    );
    const start = startAttr ? Number(startAttr) : 0;
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
        offset: offset + start,
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
  return !!(
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.code === b.code &&
    a.strikethrough === b.strikethrough &&
    a.script === b.script &&
    ((!a.link && !b.link) || (a.link && b.link && a.link.href === b.link.href))
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
    selection.type !== SelectionType.Block ||
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
          // TODO
          // @ts-expect-error
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
  console.log(value, newValue);
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
            const nodes = editableElement.querySelectorAll(
              `[data-id="${inlineNode.id}"]`,
            );
            if (nodes.length === 0) {
              throw new Error();
            }
            for (let i = 0; i < nodes.length; i++) {
              const node = nodes[i];
              let startAttr = node.getAttribute('data-paragraph-offset-start');
              let textStart = startAttr ? Number(startAttr) : 0;
              let textEnd = textStart + node.textContent!.length;
              if (
                textStart <= point.offset - start &&
                point.offset - start <= textEnd
              ) {
                return {
                  stop: true,
                  data: getTextNodeAndOffset(
                    node,
                    point.offset - textStart - start,
                  ),
                };
              }
            }
            throw new Error();
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
                Math.max(
                  range.startCell.columnIndex,
                  range.endCell.columnIndex,
                ) +
                  1 -
                  Math.min(
                    range.startCell.columnIndex,
                    range.endCell.columnIndex,
                  ),
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

function hasCommandOptionKey(event: CompatibleKeyboardEvent): boolean {
  return (
    (isApple
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && !event.metaKey) && event.altKey
  );
}

function hasNoModifiers(event: CompatibleKeyboardEvent): boolean {
  return !event.ctrlKey && !event.altKey && !event.metaKey;
}

function hasKeyCode(
  keyCode: number,
): (event: CompatibleKeyboardEvent) => boolean {
  return (event) => event.keyCode === keyCode;
}

const BACKSPACE = 8;
const ONE = 49;
const TWO = 50;
const THREE = 51;
const EIGHT = 56;
const NINE = 57;
const B = 66;
const E = 69;
const H = 72;
const I = 73;
const J = 74;
const L = 76;
const M = 77;
const R = 82;
const U = 85;
const X = 88;
const Y = 89;
const Z = 90;
const FULLSTOP = 190;
const COMMA = 188;
const QUOTE = 222;
const BACKSLASH = 220;

const isAlignLeft = allPass([hasControlKey, hasKeyCode(L)]);
const isAlignCenter = allPass([hasControlKey, hasKeyCode(E)]);
const isAlignRight = allPass([hasControlKey, hasKeyCode(R)]);
const isIndent = allPass([hasControlKey, not(hasShiftKey), hasKeyCode(M)]);
const isOutdent = allPass([hasControlKey, hasShiftKey, hasKeyCode(M)]);
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
const isHeading1 = allPass([hasCommandOptionKey, hasKeyCode(ONE)]);
const isHeading2 = allPass([hasCommandOptionKey, hasKeyCode(TWO)]);
const isHeading3 = allPass([hasCommandOptionKey, hasKeyCode(THREE)]);
const isQuote = allPass([
  hasCommandModifier,
  not(hasShiftKey),
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

function mapInlineStyleIfActive<T>(
  value: EditorValue,
  selection: Selection,
  condition: (style: TextStyle) => boolean,
  getStyle: (styles: TextStyle[]) => T,
  countEdge = true,
): T | undefined {
  if (isCollapsed(selection)) {
    if (selection.type !== SelectionType.Block) {
      return undefined;
    }
    const point = selection.start;
    if (point.type !== BlockSelectionPointType.Paragraph) {
      return undefined;
    }
    return walkEditorValues<T | undefined>(
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
        const start = removeTextFromParagraph(para, point.offset, Infinity);
        if (
          !countEdge &&
          (point.offset === 0 ||
            start.children[start.children.length - 1].text.length ===
              para.children.find(
                (inline) =>
                  inline.id === start.children[start.children.length - 1].id,
              )!.text.length)
        ) {
          return {
            stop: true,
            data: undefined,
          };
        }
        return {
          stop: true,
          data: condition(
            (start.children[start.children.length - 1] as TextNode).style,
          )
            ? getStyle([
                (start.children[start.children.length - 1] as TextNode).style,
              ])
            : undefined,
        };
      },
      undefined,
      false,
    ).retValue;
  }
  let styles: TextStyle[] = [];
  return !anyTextMatches(extractSelection(value, selection), (text) => {
    console.log(text);
    styles.push(text.style);
    return !condition(text.style);
  }) && styles.length > 0
    ? getStyle(styles)
    : undefined;
}

function getSelectionTextStyle(
  value: EditorValue,
  selection: Selection,
): TextStyle {
  return {
    bold: mapInlineStyleIfActive(
      value,
      selection,
      (style) => !!style.bold,
      () => true,
    ),
    code: mapInlineStyleIfActive(
      value,
      selection,
      (style) => !!style.code,
      () => true,
    ),
    italic: mapInlineStyleIfActive(
      value,
      selection,
      (style) => !!style.italic,
      () => true,
    ),
    script: mapInlineStyleIfActive(
      value,
      selection,
      (style) => style.script === TextScript.Superscript,
      () => true,
    )
      ? TextScript.Superscript
      : mapInlineStyleIfActive(
          value,
          selection,
          (style) => style.script === TextScript.Subscript,
          () => true,
        )
      ? TextScript.Subscript
      : undefined,
    strikethrough: mapInlineStyleIfActive(
      value,
      selection,
      (style) => !!style.strikethrough,
      () => true,
    )
      ? true
      : undefined,
    underline: mapInlineStyleIfActive(
      value,
      selection,
      (style) => !!style.underline,
      () => true,
    )
      ? true
      : undefined,
    link: mapInlineStyleIfActive(
      value,
      selection,
      (style) => !!style.link,
      (styles) =>
        styles.every((style) => style.link === styles[0].link)
          ? styles[0].link
          : undefined,
      false,
    ),
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
    if (range.startContainer.nodeName.toLowerCase() === 'BR') {
      cursorRect = (
        range.startContainer as HTMLElement
      ).getBoundingClientRect();
    } else {
      try {
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
      } catch (error) {}
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
  ReplaceBlock,
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
      origin?: string;
    }
  | {
      type: CommandType.InlineFormat;
      selection: Selection;
      condition: (style: TextStyle) => boolean;
      transform: (style: TextStyle, active: boolean) => TextStyle;
      origin?: string;
    }
  | {
      type: CommandType.BlockFormat;
      selection: Selection;
      condition: (style: ParagraphStyle) => boolean;
      transform: (style: ParagraphStyle, active: boolean) => ParagraphStyle;
      origin?: string;
    }
  | {
      type:
        | CommandType.ClearFormat
        | CommandType.Redo
        | CommandType.Undo
        | CommandType.DeleteBackwardKey;
      selection: Selection;
      origin?: string;
    };
const cmds = {
  bold: {
    isKey: isBold,
    icon: {
      isActive: (c) => !!c.textStyle.bold,
      Icon: BoldIcon,
    },
    getCmds: (selection) => [
      {
        type: CommandType.InlineFormat,
        selection,
        origin: 'bold shortcut',
        condition: (style) => !!style.bold,
        transform: (style, active) => ({
          ...style,
          bold: active ? undefined : true,
        }),
      },
    ],
  },
  italic: {
    isKey: isItalic,
    icon: {
      isActive: (c) => !!c.textStyle.italic,
      Icon: ItalicIcon,
    },
    getCmds: (selection) => [
      {
        type: CommandType.InlineFormat,
        selection,
        origin: 'italic shortcut',
        condition: (style) => !!style.italic,
        transform: (style, active) => ({
          ...style,
          italic: active ? undefined : true,
        }),
      },
    ],
  },
  underline: {
    isKey: isUnderline,
    icon: {
      isActive: (c) => !!c.textStyle.underline,
      Icon: UnderlineIcon,
    },
    getCmds: (selection) => [
      {
        type: CommandType.InlineFormat,
        selection,
        origin: 'underline shortcut',
        condition: (style) => !!style.underline,
        transform: (style, active) => ({
          ...style,
          underline: active ? undefined : true,
        }),
      },
    ],
  },
  'inline code': {
    isKey: isInlineCode,
    icon: {
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
  strikethrough: {
    isKey: isStrikethrough,
    icon: {
      isActive: (c) => !!c.textStyle.strikethrough,

      Icon: StrikethroughIcon,
    },
    getCmds: (selection) => [
      {
        type: CommandType.InlineFormat,
        selection,
        origin: 'strikethrough shortcut',
        condition: (style) => !!style.strikethrough,
        transform: (style, active) => ({
          ...style,
          strikethrough: active ? undefined : true,
        }),
      },
    ],
  },
  superscript: {
    isKey: isSuperscript,
    icon: {
      isActive: (c) => c.textStyle.script === TextScript.Superscript,
      Icon: SuperscriptIcon,
    },
    getCmds: (selection) => [
      {
        type: CommandType.InlineFormat,
        selection,
        origin: 'superscript shortcut',
        condition: (style) => style.script === TextScript.Superscript,
        transform: (style, active) => ({
          ...style,
          script: active ? undefined : TextScript.Superscript,
        }),
      },
    ],
  },
  subscript: {
    isKey: isSubscript,
    icon: {
      isActive: (c) => c.textStyle.script === TextScript.Subscript,
      Icon: SubscriptIcon,
    },
    getCmds: (selection) => [
      {
        type: CommandType.InlineFormat,
        selection,
        origin: 'subscript shortcut',
        condition: (style) => style.script === TextScript.Subscript,
        transform: (style, active) => ({
          ...style,
          script: active ? undefined : TextScript.Subscript,
        }),
      },
    ],
  },
  'heading 1': {
    isKey: isHeading1,
    icon: {
      isActive: (c) =>
        isParagraphStyleActive(
          c.value,
          c.selection!,
          (style) => style.type === ParagraphStyleType.Heading1,
        ),
      Icon: Heading1Icon,
    },
    getCmds: (selection) => [
      {
        type: CommandType.BlockFormat,
        selection,
        condition: (style) => style.type === ParagraphStyleType.Heading1,
        transform: (style, active) => ({
          ...style,
          type: active
            ? ParagraphStyleType.Default
            : ParagraphStyleType.Heading1,
        }),
      },
    ],
  },
  'heading 2': {
    isKey: isHeading2,
    icon: {
      isActive: (c) =>
        isParagraphStyleActive(
          c.value,
          c.selection!,
          (style) => style.type === ParagraphStyleType.Heading2,
        ),
      Icon: Heading2Icon,
    },
    getCmds: (selection) => [
      {
        type: CommandType.BlockFormat,
        selection,
        condition: (style) => style.type === ParagraphStyleType.Heading2,
        transform: (style, active) => ({
          ...style,
          type: active
            ? ParagraphStyleType.Default
            : ParagraphStyleType.Heading2,
        }),
      },
    ],
  },
  'heading 3': {
    isKey: isHeading3,
    icon: {
      isActive: (c) =>
        isParagraphStyleActive(
          c.value,
          c.selection!,
          (style) => style.type === ParagraphStyleType.Heading3,
        ),
      Icon: Heading2Icon,
    },
    getCmds: (selection) => [
      {
        type: CommandType.BlockFormat,
        selection,
        condition: (style) => style.type === ParagraphStyleType.Heading3,
        transform: (style, active) => ({
          ...style,
          type: active
            ? ParagraphStyleType.Default
            : ParagraphStyleType.Heading3,
        }),
      },
    ],
  },
  quote: {
    isKey: isQuote,
    icon: {
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
          ...style,
          type: active ? ParagraphStyleType.Default : ParagraphStyleType.Quote,
        }),
      },
    ],
  },
  'align left': {
    isKey: isAlignLeft,
    getCmds: (selection) => [
      {
        type: CommandType.BlockFormat,
        selection,
        condition: (style) => !style.align || style.align === TextAlign.Left,
        transform: (style, active) => ({
          ...style,
          align: active ? undefined : style.align,
        }),
      },
    ],
  },
  'align center': {
    isKey: isAlignCenter,
    getCmds: (selection) => [
      {
        type: CommandType.BlockFormat,
        selection,
        condition: (style) => style.align === TextAlign.Center,
        transform: (style, active) => ({
          ...style,
          align: active ? undefined : TextAlign.Center,
        }),
      },
    ],
  },
  'align right': {
    isKey: isAlignRight,
    getCmds: (selection) => [
      {
        type: CommandType.BlockFormat,
        selection,
        condition: (style) => style.align === TextAlign.Right,
        transform: (style, active) => ({
          ...style,
          align: active ? undefined : TextAlign.Right,
        }),
      },
    ],
  },
  indent: {
    isKey: isIndent,
    getCmds: (selection) => [
      {
        type: CommandType.BlockFormat,
        selection,
        condition: () => false,
        transform: (style) => ({
          ...style,
          indentLevel: Math.min((style.indentLevel || 0) + 1, MAX_INDENT),
        }),
      },
    ],
  },
  outdent: {
    isKey: isOutdent,
    getCmds: (selection) => [
      {
        type: CommandType.BlockFormat,
        selection,
        condition: () => false,
        transform: (style) => ({
          ...style,
          indentLevel: style.indentLevel ? style.indentLevel - 1 : undefined,
        }),
      },
    ],
  },
  'bullet list': {
    isKey: isBulletList,
    icon: {
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
              ? { ...style, type: ParagraphStyleType.Default }
              : {
                  ...style,
                  type: ParagraphStyleType.BulletList,
                  listId: getNewId(),
                },
        },
      ];
    },
  },
  'numbered list': {
    isKey: isNumberedList,
    icon: {
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
              ? { ...style, type: ParagraphStyleType.Default }
              : {
                  ...style,
                  type: ParagraphStyleType.NumberedList,
                  listId: getNewId(),
                },
        },
      ];
    },
  },
  'clear format': {
    isKey: isClearFormatting,
    getCmds: (selection) => [
      {
        type: CommandType.ClearFormat,
        selection,
      },
    ],
  },
  undo: {
    isKey: isUndo,
    getCmds: (selection) => [
      {
        type: CommandType.Undo,
        selection,
      },
    ],
  },
  redo: {
    isKey: isRedo,
    getCmds: (selection) => [
      {
        type: CommandType.Redo,
        selection,
      },
    ],
  },
  'delete backward': {
    isKey: isDeleteBackward,
    getCmds: (selection) => [
      {
        type: CommandType.DeleteBackwardKey,
        selection,
      },
    ],
  },
} satisfies {
  [name: string]: {
    isKey: (event: KeyboardEvent) => boolean;
    icon?: {
      isActive: (editorCtrl: EditorController) => boolean;
      Icon: typeof ToolbarIcon;
    };
    getCmds: (selection: Selection, makeId: () => string) => Command[];
  };
};

function useCustomCompareMemo<T, TDependencyList extends React.DependencyList>(
  factory: () => T,
  deps: readonly [...TDependencyList],
  depsAreEqual: DepsAreEqual<readonly [...TDependencyList]>,
): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

const defaultStyles: {
  [tag: string]: { [prop: string]: string | undefined } | undefined;
} = {
  article: {
    display: 'block',
  },
  aside: {
    display: 'block',
  },
  details: {
    display: 'block',
  },
  div: {
    display: 'block',
  },
  dt: {
    display: 'block',
  },
  figcaption: {
    display: 'block',
  },
  footer: {
    display: 'block',
  },
  form: {
    display: 'block',
  },
  header: {
    display: 'block',
  },
  hgroup: {
    display: 'block',
  },
  html: {
    display: 'block',
  },
  main: {
    display: 'block',
  },
  nav: {
    display: 'block',
  },
  section: {
    display: 'block',
  },
  summary: {
    display: 'block',
  },
  body: {
    display: 'block',
  },
  p: {
    display: 'block',
  },
  dl: {
    display: 'block',
  },
  multicol: {
    display: 'block',
  },
  dd: {
    display: 'block',
  },
  blockquote: {
    display: 'block',
  },
  figure: {
    display: 'block',
  },
  address: {
    display: 'block',
    fontStyle: 'italic',
  },
  center: {
    display: 'block',
  },
  h1: {
    display: 'block',
    fontWeight: 'bold',
  },
  h2: {
    display: 'block',
    fontWeight: 'bold',
  },
  h3: {
    display: 'block',
    fontWeight: 'bold',
  },
  h4: {
    display: 'block',
    fontWeight: 'bold',
  },
  h5: {
    display: 'block',
    fontWeight: 'bold',
  },
  h6: {
    display: 'block',
    fontWeight: 'bold',
  },
  pre: {
    display: 'block',
    whiteSpace: 'pre',
  },
  table: {
    display: 'table',
    textIndent: '0',
  },
  caption: {
    display: 'table-caption',
    textAlign: 'center',
  },
  tr: {
    display: 'table-row',
    verticalAlign: 'inherit',
  },
  col: {
    display: 'table-column',
  },
  colgroup: {
    display: 'table-column-group',
  },
  tbody: {
    display: 'table-row-group',
    verticalAlign: 'middle',
  },
  thead: {
    display: 'table-header-group',
    verticalAlign: 'middle',
  },
  tfoot: {
    display: 'table-footer-group',
    verticalAlign: 'middle',
  },
  td: {
    display: 'table-cell',
    verticalAlign: 'inherit',
    textAlign: 'inherit',
  },
  th: {
    display: 'table-cell',
    verticalAlign: 'inherit',
    fontWeight: '700',
    textAlign: 'inherit',
  },
  b: {
    fontWeight: '700',
  },
  strong: {
    fontWeight: '700',
  },
  i: {
    fontStyle: 'italic',
  },
  cite: {
    fontStyle: 'italic',
  },
  em: {
    fontStyle: 'italic',
  },
  var: {
    fontStyle: 'italic',
  },
  dfn: {
    fontStyle: 'italic',
  },
  u: {
    textDecoration: 'underline',
  },
  ins: {
    textDecoration: 'underline',
  },
  s: {
    textDecoration: 'line-through',
  },
  strike: {
    textDecoration: 'line-through',
  },
  del: {
    textDecoration: 'line-through',
  },
  sub: {
    verticalAlign: 'sub',
  },
  sup: {
    verticalAlign: 'super',
  },
  /* lists */
  ul: {
    display: 'block',
  },
  menu: {
    display: 'block',
  },
  dir: {
    display: 'block',
  },
  ol: {
    display: 'block',
  },
  li: {
    display: 'list-item',
    textAlign: 'inherit',
  },
  hr: {
    display: 'block',
  },
  frameset: {
    display: 'block',
  },
  base: {
    display: 'none',
  },
  basefont: {
    display: 'none',
  },
  datalist: {
    display: 'none',
  },
  head: {
    display: 'none',
  },
  link: {
    display: 'none',
  },
  meta: {
    display: 'none',
  },
  noembed: {
    display: 'none',
  },
  noframes: {
    display: 'none',
  },
  param: {
    display: 'none',
  },
  rp: {
    display: 'none',
  },
  script: {
    display: 'none',
  },
  style: {
    display: 'none',
  },
  template: {
    display: 'none',
  },
  title: {
    display: 'none',
  },
  area: {
    display: 'none',
  },
  dialog: {
    display: 'block',
  },
  marquee: {
    display: 'inline-block',
    verticalAlign: 'text-bottom',
    textAlign: 'start',
  },
};

function getStyle(
  name: keyof {
    [k in keyof CSSStyleDeclaration as k extends number
      ? never
      : CSSStyleDeclaration[k] extends string
      ? k
      : never]: string;
  },
  element: HTMLElement,
  parents: HTMLElement[],
): string | undefined {
  if (!element.style[name]) {
    const defaultS = defaultStyles[element.tagName.toLowerCase()]?.[name];
    if (defaultS) {
      return defaultS;
    }
  }
  if (
    !element.style[name] ||
    element.style[name] === 'inherit'
    // || e.style[name] === 'unset'
  ) {
    if (parents.length === 0) {
      return '';
    }
    return getStyle(name, parents[0], parents.slice(1));
  }
  if (element.style[name] === 'initial') {
    return defaultStyles[element.tagName.toLowerCase()]?.[name];
  }
  return element.style[name];
}

const sanitizeUrl = (() => {
  // https://github.com/braintree/sanitize-url/blob/main/src/index.ts.

  const invalidProtocolRegex = /^([^\w]*)(javascript|data|vbscript)/im;
  const htmlEntitiesRegex = /&#(\w+)(^\w|;)?/g;
  const htmlCtrlEntityRegex = /&(newline|tab);/gi;
  const ctrlCharactersRegex =
    /[\u0000-\u001F\u007F-\u009F\u2000-\u200D\uFEFF]/gim;
  const urlSchemeRegex = /^.+(:|&colon;)/gim;
  const relativeFirstCharacters = ['.', '/'];

  function isRelativeUrlWithoutProtocol(url: string): boolean {
    return relativeFirstCharacters.indexOf(url[0]) > -1;
  }

  // adapted from https://stackoverflow.com/a/29824550/2601552
  function decodeHtmlCharacters(str: string) {
    return str.replace(htmlEntitiesRegex, (match, dec) => {
      return String.fromCharCode(dec);
    });
  }

  return function sanitizeUrl(url?: string): string {
    const sanitizedUrl = decodeHtmlCharacters(url || '')
      .replace(htmlCtrlEntityRegex, '')
      .replace(ctrlCharactersRegex, '')
      .trim();

    if (!sanitizedUrl) {
      return 'about:blank';
    }

    if (isRelativeUrlWithoutProtocol(sanitizedUrl)) {
      return sanitizedUrl;
    }

    const urlSchemeParseResults = sanitizedUrl.match(urlSchemeRegex);

    if (!urlSchemeParseResults) {
      return sanitizedUrl;
    }

    const urlScheme = urlSchemeParseResults[0];

    if (invalidProtocolRegex.test(urlScheme)) {
      return 'about:blank';
    }

    return sanitizedUrl;
  };
})();

function getTextStylesFromElement(
  element: HTMLElement,
  parents: HTMLElement[],
): TextStyle {
  const fontWeight = getStyle('fontWeight', element, parents);
  const fontStyle = getStyle('fontStyle', element, parents);
  const textDecorationLine = getStyle('textDecorationLine', element, parents);
  const verticalAlign = getStyle('verticalAlign', element, parents);

  const isValidUrl = (urlString: string) => {
    const urlPattern = new RegExp(
      '^(https?:\\/\\/)?' + // validate protocol
        '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|' + // validate domain name
        '((\\d{1,3}\\.){3}\\d{1,3}))' + // validate OR ip (v4) address
        '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*' + // validate port and path
        '(\\?[;&a-z\\d%_.~+=-]*)?' + // validate query string
        '(\\#[-a-z\\d_]*)?$',
      'i',
    ); // validate fragment locator
    return !!urlPattern.test(urlString);
  };
  const anchor = parents.find(
    (el) =>
      el.tagName.toLowerCase() === 'a' &&
      (el as HTMLAnchorElement).href &&
      sanitizeUrl((el as HTMLAnchorElement).href) !== 'about:blank',
  );

  return {
    bold: Number(fontWeight) >= 600 ? true : undefined,
    italic:
      fontStyle === 'italic' || fontStyle === 'oblique' ? true : undefined,
    underline: textDecorationLine === 'underline' ? true : undefined,
    strikethrough: textDecorationLine === 'line-through' ? true : undefined,
    script:
      verticalAlign === 'super' || verticalAlign === 'text-top'
        ? TextScript.Superscript
        : verticalAlign === 'sub' || verticalAlign === 'text-bottom'
        ? TextScript.Subscript
        : undefined,
    code: parents.some((el) => el.tagName.toLowerCase() === 'code')
      ? true
      : undefined,
    link: anchor && {
      href: sanitizeUrl((anchor as HTMLAnchorElement).href),
    },
  };
}

function convertFromElToEditorValue(
  document: Document,
  el: HTMLElement,
  makeId: () => string,
): EditorValue {
  if (document.body === el) {
    console.log('converting html', el);
  }
  const walker = document.createTreeWalker(
    el,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (
          node.parentNode!.nodeName.toLowerCase() === 'table' ||
          node.parentNode!.nodeName.toLowerCase() === 'pre'
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        if (
          node instanceof HTMLElement &&
          (node.style.appearance === 'none' || node.style.display === 'none')
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );
  let node: Node | null;
  const blocks: BlockNode[] = [];
  function isBlock(node: Node) {
    return (
      node instanceof HTMLElement &&
      (
        ['block', 'flex', 'grid', 'list-item', 'table'] as (
          | string
          | undefined
        )[]
      ).includes(getStyle('display', node, []))
    );
  }
  function getBlockParent(node: Node): HTMLElement | null {
    let parent: HTMLElement | null = node as HTMLElement;
    while ((parent = parent!.parentElement) && parent !== el) {
      if (isBlock(parent)) {
        return parent;
      }
    }
    return null;
  }
  const idCache = new Map<any, string>();
  function makeIdCached(value: any): string {
    if (!idCache.has(value)) {
      const id = makeId();
      idCache.set(value, id);
      return id;
    }
    return idCache.get(value)!;
  }
  function getBlockParents(node: Node): HTMLElement[] {
    let parent: HTMLElement | null = node as HTMLElement;
    let parents: HTMLElement[] = [];
    while ((parent = parent!.parentElement) && parent !== el) {
      if (isBlock(parent)) {
        parents.push(parent);
      }
    }
    return parents;
  }
  const liElCache = new Set<HTMLElement>();
  function isLiParagraphAdded(liEl: HTMLElement): boolean {
    if (liElCache.has(liEl)) {
      return true;
    }
    liElCache.add(liEl);
    return false;
  }
  function makeParagraphFromNode(node: Node): ParagraphNode {
    let parents: HTMLElement[] = [];
    let parent: HTMLElement | null = node as HTMLElement;
    while ((parent = parent!.parentElement) && parent !== el) {
      parents.push(parent);
    }
    const blockParents = getBlockParents(node);
    const nearestEl = node instanceof HTMLElement ? node : node.parentElement!;
    const textAlign = getStyle('textAlign', nearestEl, parents);
    const paraStyleBase: ParagraphStyleBase = {
      align:
        textAlign === 'left'
          ? TextAlign.Left
          : textAlign === 'center'
          ? TextAlign.Center
          : textAlign === 'right'
          ? TextAlign.Right
          : textAlign === 'justify'
          ? TextAlign.Justify
          : undefined,
    };
    if (blockParents.length === 0) {
      return makeDefaultParagraph([], makeId(), paraStyleBase);
    }
    function getFirstConvertibleBlockEl(blockEls: HTMLElement[]) {
      return blockEls.find((blockEl) =>
        ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote'].includes(
          blockEl.tagName.toLowerCase(),
        ),
      );
    }
    function makeNonListBlock(blockEl?: HTMLElement): ParagraphNode {
      if (blockEl) {
        if (blockEl.tagName.toLowerCase().startsWith('h')) {
          const n = Number(blockEl.tagName.toLowerCase()[1]);
          if (n === 1) {
            return makeHeading1Paragraph([], makeId(), paraStyleBase);
          } else if (n === 2 || n === 3) {
            return makeHeading2Paragraph([], makeId(), paraStyleBase);
          } else if (n === 4 || n === 5 || n === 6) {
            return makeHeading3Paragraph([], makeId(), paraStyleBase);
          }
        }
        if (blockEl.tagName.toLowerCase().startsWith('blockquote')) {
          return makeQuoteParagraph([], makeId(), paraStyleBase);
        }
      }
      return makeDefaultParagraph([], makeId(), paraStyleBase);
    }
    const firstLiIdx = blockParents.findIndex(
      (el) => el.tagName.toLowerCase() === 'li',
    );
    if (firstLiIdx !== -1) {
      paraStyleBase.indentLevel =
        Math.max(
          Math.min(
            blockParents
              .slice(firstLiIdx + 1)
              .filter(
                (el) =>
                  el.tagName.toLowerCase() === 'ul' ||
                  el.tagName.toLowerCase() === 'ol',
              ).length - 1,
            MAX_INDENT,
          ),
          0,
        ) || undefined;
      if (isLiParagraphAdded(blockParents[firstLiIdx])) {
        paraStyleBase.indentLevel = (paraStyleBase.indentLevel || 0) + 1;
        return makeNonListBlock(
          getFirstConvertibleBlockEl(blockParents.slice(0, firstLiIdx)),
        );
      }
      const ulIdx = blockParents
        .slice(firstLiIdx + 1)
        .findIndex((el) => el.tagName.toLowerCase() === 'ul');
      const olIdx = blockParents
        .slice(firstLiIdx + 1)
        .findIndex((el) => el.tagName.toLowerCase() === 'ol');
      if (olIdx !== -1) {
        if (ulIdx === -1 || ulIdx > olIdx) {
          return makeNumberedListParagraph(
            [],
            makeIdCached(blockParents[olIdx + firstLiIdx + 1]),
            makeId(),
            paraStyleBase,
          );
        }
      }
      return makeBulletListParagraph(
        [],
        ulIdx !== -1
          ? makeIdCached(blockParents[ulIdx + firstLiIdx + 1])
          : makeId(),
        makeId(),
        paraStyleBase,
      );
    }
    return makeNonListBlock(getFirstConvertibleBlockEl(blockParents));
  }
  let prevBlockParent: HTMLElement | null | undefined = null;
  while ((node = walker.nextNode())) {
    let parentElements: HTMLElement[] = [];
    let temp: HTMLElement | null = node as HTMLElement;
    while ((temp = temp!.parentElement)) {
      parentElements.push(temp);
    }
    if (isBlock(node) || node.nodeName.toLowerCase() === 'img') {
      const blockEl = node as Element;
      if (
        blockEl.tagName.toLowerCase() === 'img' &&
        blockEl.hasAttribute('src')
      ) {
        blocks.push(
          makeImage(
            blockEl.getAttribute('src')!,
            blockEl.getAttribute('alt') || '',
            makeId(),
          ),
        );
        prevBlockParent = undefined;
        continue;
      }
      if (blockEl.tagName.toLowerCase() === 'table') {
        const rows: TableRow[] = [];
        let maxCols = 0;
        for (let i = 0; i < blockEl.childNodes.length; i++) {
          const tContainer = blockEl.childNodes[i];
          if (
            !tContainer ||
            (tContainer.nodeName.toLowerCase() !== 'thead' &&
              tContainer.nodeName.toLowerCase() !== 'tbody' &&
              tContainer.nodeName.toLowerCase() !== 'tfoot')
          ) {
            continue;
          }
          for (let i = 0; i < tContainer.childNodes.length; i++) {
            const tr = tContainer.childNodes[i];
            if (tr.nodeName.toLowerCase() !== 'tr') {
              continue;
            }
            const cells: TableCell[] = [];
            for (let i = 0; i < tr.childNodes.length; i++) {
              const cellNode = tr.childNodes[i];
              if (
                cellNode.nodeName.toLowerCase() !== 'th' &&
                cellNode.nodeName.toLowerCase() !== 'td'
              ) {
                continue;
              }
              cells.push(
                makeTableCell(
                  convertFromElToEditorValue(
                    document,
                    cellNode as HTMLElement,
                    makeId,
                  ),
                  makeId(),
                ),
              );
            }
            if (cells.length === 0) {
              continue;
            }
            maxCols = Math.max(maxCols, cells.length);
            rows.push(makeTableRow(cells, makeId()));
          }
        }
        if (rows.length === 0) {
          prevBlockParent = undefined;
          continue;
        }
        blocks.push(makeTable(rows, maxCols, makeId()));
        prevBlockParent = undefined;
        continue;
      }
      if (blockEl.tagName.toLowerCase() === 'pre') {
        const code = blockEl.textContent!;
        blocks.push(makeCodeBlock(code, undefined, makeId()));
      }
      prevBlockParent = undefined;
      continue;
    }
    const parentBlock = getBlockParent(node);
    if (node.nodeName.toLowerCase() === 'br') {
      const style = getTextStylesFromElement(
        node.parentElement!,
        parentElements,
      );
      const para = makeParagraphFromNode(node);
      para.children.push(makeText('', style, makeId()));
      blocks.push(para);
      prevBlockParent = parentBlock;
      continue;
    }
    if (node.nodeType === Node.TEXT_NODE && node.textContent) {
      const text = node.textContent;
      const style = getTextStylesFromElement(
        node.parentElement!,
        parentElements,
      );
      const lastBlock =
        blocks.length > 0 ? blocks[blocks.length - 1] : undefined;
      if (parentBlock === prevBlockParent && lastBlock && !lastBlock.isBlock) {
        lastBlock.children.push(makeText(text, style, makeId()));
      } else {
        const para = makeParagraphFromNode(node);
        para.children.push(makeText(text, style, makeId()));
        blocks.push(para);
      }
      prevBlockParent = parentBlock;
    }
  }
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (!block.isBlock) {
      blocks[i] = fixParagraph(block);
    }
  }
  return makeEditorValue(
    blocks.length === 0
      ? [makeDefaultParagraph([makeDefaultText('', makeId())], makeId())]
      : blocks,
    makeId(),
  );
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
    newSelection: Selection | null,
    newTextStyle: TextStyle,
    action: PushStateAction | string,
    merge = false,
  ): EditorController {
    let undos = curEditorCtrl.undos;
    if (
      !merge &&
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
    let ignoreNext: boolean = false;
    let ignoreSelectionN = 0;
    function processCommand(command: Command, i: number | null): void {
      if (ignoreNext) {
        ignoreNext = false;
        return;
      }
      const originalSelection = command.selection;
      let inputSelection = mapSelectionFns.reduce(
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
              if (i !== null && i < queue.length - 1) {
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
          case 'insertFromDrop':
          case 'x_ReplaceBlock_MergeHistory': {
            let action: PushStateAction | string;
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
            } else if (inputType === 'x_ReplaceBlock_MergeHistory') {
              action = `x_ReplaceBlock_MergeHistory_${
                (data as RichDataTransfer).value.blocks[0].id
              }`;
            } else {
              action = PushStateAction.Insert;
            }
            if (!data) {
              return;
            }
            let insertValue: EditorValue;
            let mergeHistory = dropValue !== null;
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
            console.log('new editor', newEditorCtrl);
            newEditorCtrl = pushState(
              newEditorCtrl,
              newValue,
              inputType === 'x_ReplaceBlock_MergeHistory' ? null : newSelection,
              newTextStyle,
              action,
              mergeHistory,
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
          case 'historyUndo': {
            processCommand(
              {
                type: CommandType.Undo,
                selection: inputSelection,
              },
              null,
            );
            break;
          }
          case 'historyRedo': {
            processCommand(
              {
                type: CommandType.Redo,
                selection: inputSelection,
              },
              null,
            );
            break;
          }
          case 'formatBold':
          case 'formatItalic':
          case 'formatUnderline':
          case 'formatStrikeThrough':
          case 'formatSuperscript':
          case 'formatSubscript': {
            cmds[
              (
                {
                  formatBold: 'bold',
                  formatItalic: 'italic',
                  formatUnderline: 'underline',
                  formatStrikeThrough: 'strikethrough',
                  formatSuperscript: 'superscript',
                  formatSubscript: 'subscript',
                } as const
              )[inputType]
            ]
              .getCmds(inputSelection)
              .forEach((cmd) => processCommand(cmd, null));
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
        if (
          (
            [
              'bold shortcut',
              'italic shortcut',
              'underline shortcut',
              'strikethrough shortcut',
              'superscript shortcut',
              'subscript shortcut',
            ] as (string | undefined)[]
          ).includes(command.origin) &&
          i !== null &&
          i + 1 < queue.length
        ) {
          const next = queue[i + 1];
          if (
            next.type === CommandType.Input &&
            next.inputType ===
              {
                'bold shortcut': 'formatBold',
                'italic shortcut': 'formatItalic',
                'underline shortcut': 'formatUnderline',
                'strikethrough shortcut': 'formatStrikeThrough',
                'superscript shortcut': 'formatSuperscript',
                'subscript shortcut': 'formatSubscript',
              }[command.origin!]
          ) {
            ignoreNext = true;
          }
        }
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
          return;
        }
        console.log('undoing');
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
        console.log(newEditorCtrl);
      } else if (command.type === CommandType.Redo) {
        if (newEditorCtrl.redos.length === 0) {
          return;
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
          return;
        }
        const point = (inputSelection as BlockSelection).start;
        if (
          point.type !== BlockSelectionPointType.Paragraph ||
          point.offset !== 0
        ) {
          return;
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
              style.type === ParagraphStyleType.Quote ||
              style.hangingIndent ||
              style.indentLevel ||
              (style.align && style.align !== TextAlign.Left)
            ) {
              return {
                stop: true,
                data: true,
                newValue: makeEditorValue(
                  subValue.blocks.map((block) => {
                    if (block.id === point.blockId) {
                      if (
                        style.type === ParagraphStyleType.BulletList ||
                        style.type === ParagraphStyleType.NumberedList
                      ) {
                        return makeDefaultParagraph(para.children, para.id, {
                          ...omit(para.style, ['type']),
                          indentLevel: Math.min(
                            MAX_INDENT,
                            (para.style.indentLevel || 0) + 1,
                          ),
                        });
                      }
                      if (style.type === ParagraphStyleType.Quote) {
                        return makeDefaultParagraph(
                          para.children,
                          para.id,
                          omit(para.style, ['type']),
                        );
                      }
                      if (style.hangingIndent) {
                        return makeParagraph(
                          para.children,
                          omit(
                            para.style as Exclude<
                              ParagraphStyle,
                              {
                                type:
                                  | ParagraphStyleType.BulletList
                                  | ParagraphStyleType.NumberedList
                                  | ParagraphStyleType.Quote;
                              }
                            >,
                            ['hangingIndent'],
                          ),
                          para.id,
                        );
                      }
                      if (style.indentLevel) {
                        return makeParagraph(
                          para.children,
                          omit(
                            para.style as Exclude<
                              ParagraphStyle,
                              {
                                type:
                                  | ParagraphStyleType.BulletList
                                  | ParagraphStyleType.NumberedList
                                  | ParagraphStyleType.Quote;
                              }
                            >,
                            ['indentLevel'],
                          ),
                          para.id,
                        );
                      }
                      return makeParagraph(
                        para.children,
                        omit(
                          para.style as Exclude<
                            ParagraphStyle,
                            {
                              type:
                                | ParagraphStyleType.BulletList
                                | ParagraphStyleType.NumberedList
                                | ParagraphStyleType.Quote;
                            }
                          >,
                          ['align'],
                        ),
                        para.id,
                      );
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
          if (i !== null && i < queue.length - 1) {
            const next = queue[i + 1];
            if (
              next.type === CommandType.Input &&
              (next.inputType === 'deleteContentBackward' ||
                next.inputType === 'deleteWordBackward' ||
                next.inputType === 'deleteSoftLineBackward' ||
                next.inputType === 'deleteHardLineBackward')
            ) {
              ignoreNext = true;
            }
          }
        }
      }
    }
    for (let i = 0; i < queue.length; i++) {
      processCommand(queue[i], i);
    }
    if (ignoreSelectionN < queue.length) {
      newDomSelectionRef.current = newEditorCtrl.selection;
    }
    if (editorCtrl.current !== newEditorCtrl) {
      editorCtrl.current = newEditorCtrl;
      flushSync(() => {
        setRenderToggle((t) => !t);
      });
    }
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
    if (document.activeElement !== editorRef.current) {
      return;
    }
    event.preventDefault();
    const curNativeSelection = window.getSelection();
    const targetRange =
      event.getTargetRanges()[0] || curNativeSelection?.getRangeAt(0);
    let selection: Selection;
    try {
      selection = findSelection(editorCtrl.current.value, targetRange, false);
    } catch (error) {
      console.error('error finding selection', error);
      return;
    }
    if (curNativeSelection) {
      const nativeSelection = findSelection(
        editorCtrl.current.value,
        curNativeSelection!.getRangeAt(0),
        isSelectionBackwards(curNativeSelection!),
      );
      if (
        (nativeSelection.editorId === selection.editorId &&
          nativeSelection.type === SelectionType.Table &&
          selection.type === SelectionType.Table &&
          nativeSelection.tableId === selection.tableId &&
          nativeSelection.startCell.rowIndex === selection.endCell.rowIndex &&
          nativeSelection.startCell.columnIndex ===
            selection.endCell.columnIndex &&
          nativeSelection.endCell.rowIndex === selection.startCell.rowIndex &&
          nativeSelection.endCell.columnIndex ===
            selection.startCell.columnIndex) ||
        (nativeSelection.type === SelectionType.Block &&
          selection.type === SelectionType.Block &&
          nativeSelection.start.blockId === selection.end.blockId &&
          ((nativeSelection.start.type === BlockSelectionPointType.OtherBlock &&
            selection.end.type === BlockSelectionPointType.OtherBlock) ||
            (nativeSelection.start.type === BlockSelectionPointType.Paragraph &&
              selection.end.type === BlockSelectionPointType.Paragraph &&
              nativeSelection.start.offset === selection.end.offset)) &&
          nativeSelection.end.blockId === selection.start.blockId &&
          ((nativeSelection.end.type === BlockSelectionPointType.OtherBlock &&
            selection.start.type === BlockSelectionPointType.OtherBlock) ||
            (nativeSelection.end.type === BlockSelectionPointType.Paragraph &&
              selection.start.type === BlockSelectionPointType.Paragraph &&
              nativeSelection.end.offset === selection.start.offset)))
      ) {
        selection = nativeSelection;
      }
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
          if (!data) {
            data = {
              type: DataTransferType.Rich,
              value: convertFromElToEditorValue(
                parsedDocument,
                parsedDocument.body,
                makeId,
              ),
            };
          }
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
    function isBatch(cmd: Command): boolean {
      return (
        cmd.type === CommandType.DeleteBackwardKey ||
        (cmd.type === CommandType.InlineFormat &&
          (
            [
              'bold shortcut',
              'italic shortcut',
              'underline shortcut',
              'strikethrough shortcut',
              'superscript shortcut',
              'subscript shortcut',
            ] as (string | undefined)[]
          ).includes(command.origin)) ||
        (cmd.type === CommandType.Input && cmd.inputType === 'deleteByDrag')
      );
    }
    if (inputQueueRef.current.length === 0) {
      if (!isBatch(command)) {
        inputQueueRef.current.push(command);
        flushInputQueue();
        return;
      }
      inputQueueRequestRef.current = requestAnimationFrame(flushInputQueue);
    } else {
      const lastCommand =
        inputQueueRef.current[inputQueueRef.current.length - 1];
      if (isBatch(lastCommand)) {
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

    const nativeSelection = window.getSelection()!;

    if (
      document.activeElement !== editorRef.current ||
      nativeSelection.rangeCount === 0
    ) {
      if (editorCtrl.current.selection) {
        editorCtrl.current = pushState(
          editorCtrl.current,
          editorCtrl.current.value,
          null,
          {},
          PushStateAction.Selection,
        );
        flushSync(() => {
          setRenderToggle((t) => !t);
        });
      }
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
      flushSync(() => {
        setRenderToggle((t) => !t);
      });
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
                    <ReactEditorValue
                      queueCommand={() => {
                        throw new Error('Command queued in copy');
                      }}
                      value={curValue}
                    />
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
    if (!nativeSelection || document.activeElement !== editorRef.current) {
      return;
    }
    const curSelection = findSelection(
      editorCtrl.current.value,
      nativeSelection.getRangeAt(0),
      isSelectionBackwards(nativeSelection),
    );
    if (!isCollapsed(curSelection)) {
      copySelection(editorCtrl.current.value, curSelection);
    }
    event.preventDefault();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const curSelection = window.getSelection();
    if (!curSelection || document.activeElement !== editorRef.current) {
      return;
    }
    const cmdKV = Object.entries(cmds);
    for (let i = 0; i < cmdKV.length; i++) {
      const [_name, cmd] = cmdKV[i];
      if (cmd.isKey(event)) {
        if (cmd !== cmds['delete backward']) {
          event.preventDefault();
        }
        cmd
          .getCmds(
            findSelection(
              editorCtrl.current.value,
              curSelection.getRangeAt(0),
              isSelectionBackwards(curSelection),
            ),
            editorCtrl.current.makeId,
          )
          .forEach((command) => {
            queueCommand(command);
          });
        break;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        {Object.entries(cmds)
          .filter(
            (
              a,
            ): a is [
              string,
              Extract<typeof cmds[keyof typeof cmds], { icon: object }>,
            ] => 'icon' in a[1] && a[1].icon !== undefined,
          )
          .map(([name, cmd]) => {
            const isActive = editorCtrl.current.selection
              ? cmd.icon.isActive(editorCtrl.current)
              : false;
            const Icon = cmd.icon.Icon;
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
              <Tooltip info={name} key={name}>
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
        className="editor"
      >
        <SelectedEditorsContext.Provider value={selectedEditors}>
          <NumberedListIndicesContext.Provider value={listBlockIdToIdx}>
            <ReactEditorValue
              queueCommand={queueCommand}
              value={editorCtrl.current.value}
            />
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

function Heading1Icon(props: ToolbarIconProps): JSX.Element {
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

function Heading2Icon(props: ToolbarIconProps): JSX.Element {
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
  const initialValue = {blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"JavaScript basics",style:{},id:"1613"}],style:{type:"Heading 1"},id:"1612"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"JavaScript is a programming language that adds interactivity to your website. This happens in games, in the behavior of responses when buttons are pressed or with data entry on forms; with dynamic styling; with animation, etc. This article helps you get started with JavaScript and furthers your understanding of what is possible.",style:{},id:"1615"}],style:{type:"Default"},id:"1614"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"What is JavaScript?",style:{link:{href:"https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web/JavaScript_basics#what_is_javascript"}},id:"1617"}],style:{type:"Heading 2"},id:"1616"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"JavaScript",style:{underline:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Glossary/JavaScript"}},id:"1619"},{type:"Inline/Text",isBlock:!1,text:"\xa0is a powerful programming language that can add interactivity to a website. It was invented by Brendan Eich.",style:{},id:"1620"}],style:{type:"Default"},id:"1618"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"JavaScript is versatile and beginner-friendly. With more experience, you'll be able to create games, animated 2D and 3D graphics, comprehensive database-driven apps, and much more!",style:{},id:"1623"}],style:{type:"Default"},id:"1622"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"JavaScript itself is relatively compact, yet very flexible. Developers have written a variety of tools on top of the core JavaScript language, unlocking a vast amount of functionality with minimum effort. These include:",style:{},id:"1625"}],style:{type:"Default"},id:"1624"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Browser Application Programming Interfaces (",style:{},id:"1628"},{type:"Inline/Text",isBlock:!1,text:"APIs",style:{underline:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Glossary/API"}},id:"1629"},{type:"Inline/Text",isBlock:!1,text:") built into web browsers, providing functionality such as dynamically creating HTML and setting CSS styles; collecting and manipulating a video stream from a user's webcam, or generating 3D graphics and audio samples.",style:{},id:"1630"}],style:{type:"Bullet List",listId:"1626"},id:"1627"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Third-party APIs that allow developers to incorporate functionality in sites from other content providers, such as Twitter or Facebook.",style:{},id:"1632"}],style:{type:"Bullet List",listId:"1626"},id:"1631"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Third-party frameworks and libraries that you can apply to HTML to accelerate the work of building sites and applications.",style:{},id:"1634"}],style:{type:"Bullet List",listId:"1626"},id:"1633"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"It's outside the scope of this article—as a light introduction to JavaScript—to present the details of how the core JavaScript language is different from the tools listed above. You can learn more in MDN's\xa0",style:{},id:"1636"},{type:"Inline/Text",isBlock:!1,text:"JavaScript learning area",style:{underline:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Learn/JavaScript"}},id:"1638"},{type:"Inline/Text",isBlock:!1,text:", as well as in other parts of MDN.",style:{},id:"1639"}],style:{type:"Default"},id:"1635"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"The section below introduces some aspects of the core language and offers an opportunity to play with a few browser API features too. Have fun!",style:{},id:"1641"}],style:{type:"Default"},id:"1640"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:'A "Hello world!" example',style:{link:{href:"https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web/JavaScript_basics#a_hello_world!_example"}},id:"1643"}],style:{type:"Heading 2"},id:"1642"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"JavaScript is one of the most popular modern web technologies! As your JavaScript skills grow, your websites will enter a new dimension of power and creativity.",style:{},id:"1645"}],style:{type:"Default"},id:"1644"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"However, getting comfortable with JavaScript is more challenging than getting comfortable with HTML and CSS. You may have to start small, and progress gradually. To begin, let's examine how to add JavaScript to your page for creating a\xa0",style:{},id:"1647"},{type:"Inline/Text",isBlock:!1,text:"Hello world!",style:{italic:!0},id:"1649"},{type:"Inline/Text",isBlock:!1,text:"\xa0example. (",style:{},id:"1650"},{type:"Inline/Text",isBlock:!1,text:"Hello world!",style:{italic:!0},id:"1652"},{type:"Inline/Text",isBlock:!1,text:"\xa0is\xa0",style:{},id:"1653"},{type:"Inline/Text",isBlock:!1,text:"the standard for introductory programming examples",style:{underline:!0,link:{href:"https://en.wikipedia.org/wiki/%22Hello,_World!%22_program"}},id:"1656"},{type:"Inline/Text",isBlock:!1,text:".)",style:{},id:"1657"}],style:{type:"Default"},id:"1646"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Warning:\xa0If you haven't been following along with the rest of our course,\xa0",style:{},id:"1659"},{type:"Inline/Text",isBlock:!1,text:"download this example code",style:{underline:!0,link:{href:"https://codeload.github.com/mdn/beginner-html-site-styled/zip/refs/heads/gh-pages"}},id:"1663"},{type:"Inline/Text",isBlock:!1,text:"\xa0and use it as a starting point.",style:{},id:"1664"}],style:{type:"Default"},id:"1658"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Go to your test site and create a new folder named\xa0",style:{},id:"1668"},{type:"Inline/Text",isBlock:!1,text:"scripts",style:{code:!0},id:"1670"},{type:"Inline/Text",isBlock:!1,text:". Within the scripts folder, create a new text document called\xa0",style:{},id:"1671"},{type:"Inline/Text",isBlock:!1,text:"main.js",style:{code:!0},id:"1673"},{type:"Inline/Text",isBlock:!1,text:", and save it.",style:{},id:"1674"}],style:{type:"Numbered List",listId:"1666"},id:"1667"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"In your\xa0",style:{},id:"1676"},{type:"Inline/Text",isBlock:!1,text:"index.html",style:{code:!0},id:"1678"},{type:"Inline/Text",isBlock:!1,text:"\xa0file, enter this code on a new line, just before the closing\xa0",style:{},id:"1679"},{type:"Inline/Text",isBlock:!1,text:"</body>",style:{code:!0},id:"1682"},{type:"Inline/Text",isBlock:!1,text:"\xa0tag:",style:{},id:"1683"}],style:{type:"Numbered List",listId:"1666"},id:"1675"},{type:"Block/Code",isBlock:!0,code:'<script src="scripts/main.js"></script>\n',id:"1685"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"This is doing the same job as the\xa0",style:{},id:"1687"},{type:"Inline/Text",isBlock:!1,text:"<link>",style:{underline:!0,code:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Web/HTML/Element/link"}},id:"1689"},{type:"Inline/Text",isBlock:!1,text:"\xa0element for CSS. It applies the JavaScript to the page, so it can have an effect on the HTML (along with the CSS, and anything else on the page).",style:{},id:"1690"}],style:{type:"Numbered List",listId:"1666"},id:"1686"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Add this code to the\xa0",style:{},id:"1693"},{type:"Inline/Text",isBlock:!1,text:"main.js",style:{code:!0},id:"1695"},{type:"Inline/Text",isBlock:!1,text:"\xa0file:",style:{},id:"1696"}],style:{type:"Numbered List",listId:"1666"},id:"1692"},{type:"Block/Code",isBlock:!0,code:'const myHeading = document.querySelector("h1");\nmyHeading.textContent = "Hello world!";\n',id:"1698"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Make sure the HTML and JavaScript files are saved. Then load\xa0",style:{},id:"1700"},{type:"Inline/Text",isBlock:!1,text:"index.html",style:{code:!0},id:"1702"},{type:"Inline/Text",isBlock:!1,text:"\xa0in your browser. You should see something like this:",style:{},id:"1703"}],style:{type:"Numbered List",listId:"1666"},id:"1699"},{type:"Block/Image",isBlock:!0,src:"https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web/JavaScript_basics/hello-world.png",caption:'Heading "hello world" above a firefox logo',id:"1705"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Note:\xa0The reason the instructions (above) place the\xa0",style:{},id:"1707"},{type:"Inline/Text",isBlock:!1,text:"<script>",style:{underline:!0,code:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script"}},id:"1711"},{type:"Inline/Text",isBlock:!1,text:"\xa0element near the bottom of the HTML file is that\xa0the browser reads code in the order it appears in the file.",style:{},id:"1712"}],style:{type:"Default"},id:"1706"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"If the JavaScript loads first and it is supposed to affect the HTML that hasn't loaded yet, there could be problems. Placing JavaScript near the bottom of an HTML page is one way to accommodate this dependency. To learn more about alternative approaches, see\xa0",style:{},id:"1718"},{type:"Inline/Text",isBlock:!1,text:"Script loading strategies",style:{underline:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Learn/JavaScript/First_steps/What_is_JavaScript#script_loading_strategies"}},id:"1720"},{type:"Inline/Text",isBlock:!1,text:".",style:{},id:"1721"}],style:{type:"Default"},id:"1717"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"What happened?",style:{link:{href:"https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web/JavaScript_basics#what_happened"}},id:"1723"}],style:{type:"Heading 2"},id:"1722"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"The heading text changed to\xa0",style:{},id:"1725"},{type:"Inline/Text",isBlock:!1,text:"Hello world!",style:{italic:!0},id:"1727"},{type:"Inline/Text",isBlock:!1,text:"\xa0using JavaScript. You did this by using a function called\xa0",style:{},id:"1728"},{type:"Inline/Text",isBlock:!1,text:"querySelector()",style:{underline:!0,code:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Web/API/Document/querySelector"}},id:"1731"},{type:"Inline/Text",isBlock:!1,text:"\xa0to grab a reference to your heading, and then store it in a variable called\xa0",style:{},id:"1732"},{type:"Inline/Text",isBlock:!1,text:"myHeading",style:{code:!0},id:"1735"},{type:"Inline/Text",isBlock:!1,text:". This is similar to what we did using CSS selectors. When you want to do something to an element, you need to select it first.",style:{},id:"1736"}],style:{type:"Default"},id:"1724"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Following that, the code set the value of the\xa0",style:{},id:"1738"},{type:"Inline/Text",isBlock:!1,text:"myHeading",style:{code:!0},id:"1740"},{type:"Inline/Text",isBlock:!1,text:"\xa0variable's\xa0",style:{},id:"1741"},{type:"Inline/Text",isBlock:!1,text:"textContent",style:{underline:!0,code:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Web/API/Node/textContent"}},id:"1744"},{type:"Inline/Text",isBlock:!1,text:"\xa0property (which represents the content of the heading) to\xa0",style:{},id:"1745"},{type:"Inline/Text",isBlock:!1,text:"Hello world!",style:{italic:!0},id:"1748"},{type:"Inline/Text",isBlock:!1,text:".",style:{},id:"1749"}],style:{type:"Default"},id:"1737"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Note:\xa0Both of the features you used in this exercise are parts of the\xa0",style:{},id:"1751"},{type:"Inline/Text",isBlock:!1,text:"Document Object Model (DOM) API",style:{underline:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Web/API/Document_Object_Model"}},id:"1755"},{type:"Inline/Text",isBlock:!1,text:", which has the capability to manipulate documents.",style:{},id:"1756"}],style:{type:"Default"},id:"1750"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Language basics crash course",style:{link:{href:"https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web/JavaScript_basics#language_basics_crash_course"}},id:"1758"}],style:{type:"Heading 2"},id:"1757"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"To give you a better understanding of how JavaScript works, let's explain some of the core features of the language. It's worth noting that these features are common to all programming languages. If you master these fundamentals, you have a head start on coding in other languages too!",style:{},id:"1760"}],style:{type:"Default"},id:"1759"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Warning:\xa0In this article, try entering the example code lines into your JavaScript console to see what happens. For more details on JavaScript consoles, see\xa0",style:{},id:"1762"},{type:"Inline/Text",isBlock:!1,text:"Discover browser developer tools",style:{underline:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Learn/Common_questions/Tools_and_setup/What_are_browser_developer_tools"}},id:"1766"},{type:"Inline/Text",isBlock:!1,text:".",style:{},id:"1767"}],style:{type:"Default"},id:"1761"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Variables",style:{link:{href:"https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web/JavaScript_basics#variables"}},id:"1769"}],style:{type:"Heading 2"},id:"1768"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Variables",style:{underline:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Glossary/Variable"}},id:"1771"},{type:"Inline/Text",isBlock:!1,text:"\xa0are containers that store values. You start by declaring a variable with the\xa0",style:{},id:"1772"},{type:"Inline/Text",isBlock:!1,text:"let",style:{underline:!0,code:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/let"}},id:"1775"},{type:"Inline/Text",isBlock:!1,text:"\xa0keyword, followed by the name you give to the variable:",style:{},id:"1776"}],style:{type:"Default"},id:"1770"},{type:"Block/Code",isBlock:!0,code:"let myVariable;\n",id:"1778"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"A semicolon at the end of a line indicates where a statement ends. It is only required when you need to separate statements on a single line. However, some people believe it's good practice to have semicolons at the end of each statement. There are other rules for when you should and shouldn't use semicolons. For more details, see\xa0",style:{},id:"1780"},{type:"Inline/Text",isBlock:!1,text:"Your Guide to Semicolons in JavaScript",style:{underline:!0,link:{href:"https://www.codecademy.com/resources/blog/your-guide-to-semicolons-in-javascript/"}},id:"1782"},{type:"Inline/Text",isBlock:!1,text:".",style:{},id:"1783"}],style:{type:"Default"},id:"1779"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"You can name a variable nearly anything, but there are some restrictions. (See\xa0",style:{},id:"1785"},{type:"Inline/Text",isBlock:!1,text:"this section about naming rules",style:{underline:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Grammar_and_types#variables"}},id:"1787"},{type:"Inline/Text",isBlock:!1,text:".) If you are unsure, you can\xa0",style:{},id:"1788"},{type:"Inline/Text",isBlock:!1,text:"check your variable name",style:{underline:!0,link:{href:"https://mothereff.in/js-variables"}},id:"1790"},{type:"Inline/Text",isBlock:!1,text:"\xa0to see if it's valid.",style:{},id:"1791"}],style:{type:"Default"},id:"1784"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"JavaScript is case sensitive. This means\xa0",style:{},id:"1794"},{type:"Inline/Text",isBlock:!1,text:"myVariable",style:{code:!0},id:"1796"},{type:"Inline/Text",isBlock:!1,text:"\xa0is not the same as\xa0",style:{},id:"1797"},{type:"Inline/Text",isBlock:!1,text:"myvariable",style:{code:!0},id:"1800"},{type:"Inline/Text",isBlock:!1,text:". If you have problems in your code, check the case!",style:{},id:"1801"}],style:{type:"Default"},id:"1793"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"After declaring a variable, you can give it a value:",style:{},id:"1803"}],style:{type:"Default"},id:"1802"},{type:"Block/Code",isBlock:!0,code:'myVariable = "Bob";\n',id:"1804"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Also, you can do both these operations on the same line:",style:{},id:"1806"}],style:{type:"Default"},id:"1805"},{type:"Block/Code",isBlock:!0,code:'let myVariable = "Bob";\n',id:"1807"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"You retrieve the value by calling the variable name:",style:{},id:"1809"}],style:{type:"Default"},id:"1808"},{type:"Block/Code",isBlock:!0,code:"myVariable;\n",id:"1810"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"After assigning a value to a variable, you can change it later in the code:",style:{},id:"1812"}],style:{type:"Default"},id:"1811"},{type:"Block/Code",isBlock:!0,code:'let myVariable = "Bob";\nmyVariable = "Steve";\n',id:"1813"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Note that variables may hold values that have different\xa0",style:{},id:"1815"},{type:"Inline/Text",isBlock:!1,text:"data types",style:{underline:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures"}},id:"1817"},{type:"Inline/Text",isBlock:!1,text:":",style:{},id:"1818"}],style:{type:"Default"},id:"1814"},{type:"Block/Table",isBlock:!0,rows:[{cells:[{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Variable",style:{},id:"1820"}],style:{type:"Default",align:"Left"},id:"1819"}],id:"1821"},id:"1822"},{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Explanation",style:{},id:"1824"}],style:{type:"Default",align:"Left"},id:"1823"}],id:"1825"},id:"1826"},{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Example",style:{},id:"1828"}],style:{type:"Default",align:"Left"},id:"1827"}],id:"1829"},id:"1830"}],id:"1831"},{cells:[{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"String",style:{underline:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Glossary/String"}},id:"1833"}],style:{type:"Default"},id:"1832"}],id:"1834"},id:"1835"},{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"This is a sequence of text known as a string. To signify that the value is a string, enclose it in single or double quote marks.",style:{},id:"1837"}],style:{type:"Default"},id:"1836"}],id:"1838"},id:"1839"},{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"let myVariable = 'Bob';",style:{code:!0},id:"1841"},{type:"Inline/Text",isBlock:!1,text:"\xa0or",style:{},id:"1842"}],style:{type:"Default"},id:"1840"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:'let myVariable = "Bob";',style:{code:!0},id:"1846"}],style:{type:"Default"},id:"1844"}],id:"1847"},id:"1848"}],id:"1849"},{cells:[{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Number",style:{underline:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Glossary/Number"}},id:"1851"}],style:{type:"Default"},id:"1850"}],id:"1852"},id:"1853"},{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"This is a number. Numbers don't have quotes around them.",style:{},id:"1855"}],style:{type:"Default"},id:"1854"}],id:"1856"},id:"1857"},{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"let myVariable = 10;",style:{code:!0},id:"1859"}],style:{type:"Default"},id:"1858"}],id:"1860"},id:"1861"}],id:"1862"},{cells:[{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Boolean",style:{underline:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Glossary/Boolean"}},id:"1864"}],style:{type:"Default"},id:"1863"}],id:"1865"},id:"1866"},{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"This is a True/False value. The words\xa0",style:{},id:"1868"},{type:"Inline/Text",isBlock:!1,text:"true",style:{code:!0},id:"1870"},{type:"Inline/Text",isBlock:!1,text:"\xa0and\xa0",style:{},id:"1871"},{type:"Inline/Text",isBlock:!1,text:"false",style:{code:!0},id:"1874"},{type:"Inline/Text",isBlock:!1,text:"\xa0are special keywords that don't need quote marks.",style:{},id:"1875"}],style:{type:"Default"},id:"1867"}],id:"1877"},id:"1878"},{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"let myVariable = true;",style:{code:!0},id:"1880"}],style:{type:"Default"},id:"1879"}],id:"1881"},id:"1882"}],id:"1883"},{cells:[{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Array",style:{underline:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Glossary/Array"}},id:"1885"}],style:{type:"Default"},id:"1884"}],id:"1886"},id:"1887"},{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"This is a structure that allows you to store multiple values in a single reference.",style:{},id:"1889"}],style:{type:"Default"},id:"1888"}],id:"1890"},id:"1891"},{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"let myVariable = [1,'Bob','Steve',10];",style:{code:!0},id:"1893"}],style:{type:"Default"},id:"1892"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Refer to each member of the array like this:",style:{},id:"1896"}],style:{type:"Default"},id:"1894"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"myVariable[0]",style:{code:!0},id:"1899"},{type:"Inline/Text",isBlock:!1,text:",\xa0",style:{},id:"1900"},{type:"Inline/Text",isBlock:!1,text:"myVariable[1]",style:{code:!0},id:"1902"},{type:"Inline/Text",isBlock:!1,text:", etc.",style:{},id:"1903"}],style:{type:"Default"},id:"1897"}],id:"1904"},id:"1905"}],id:"1906"},{cells:[{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Object",style:{underline:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Glossary/Object"}},id:"1908"}],style:{type:"Default"},id:"1907"}],id:"1909"},id:"1910"},{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"This can be anything. Everything in JavaScript is an object and can be stored in a variable. Keep this in mind as you learn.",style:{},id:"1912"}],style:{type:"Default"},id:"1911"}],id:"1913"},id:"1914"},{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"let myVariable = document.querySelector('h1');",style:{code:!0},id:"1916"}],style:{type:"Default"},id:"1915"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"All of the above examples too.",style:{},id:"1919"}],style:{type:"Default"},id:"1917"}],id:"1920"},id:"1921"}],id:"1922"}],numColumns:3,id:"1923"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"So why do we need variables? Variables are necessary to do anything interesting in programming. If values couldn't change, then you couldn't do anything dynamic, like personalize a greeting message or change an image displayed in an image gallery.",style:{},id:"1925"}],style:{type:"Default"},id:"1924"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Comments",style:{link:{href:"https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web/JavaScript_basics#comments"}},id:"1927"}],style:{type:"Heading 2"},id:"1926"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Comments are snippets of text that can be added along with code. The browser ignores text marked as comments. You can write comments in JavaScript just as you can in CSS:",style:{},id:"1929"}],style:{type:"Default"},id:"1928"},{type:"Block/Code",isBlock:!0,code:"/*\nEverything in between is a comment.\n*/\n",id:"1930"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"If your comment contains no line breaks, it's an option to put it behind two slashes like this:",style:{},id:"1932"}],style:{type:"Default"},id:"1931"},{type:"Block/Code",isBlock:!0,code:"// This is a comment\n",id:"1933"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Operators",style:{link:{href:"https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web/JavaScript_basics#operators"}},id:"1935"}],style:{type:"Heading 2"},id:"1934"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"An\xa0",style:{},id:"1937"},{type:"Inline/Text",isBlock:!1,text:"operator",style:{underline:!0,code:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Glossary/Operator"}},id:"1939"},{type:"Inline/Text",isBlock:!1,text:"\xa0is a mathematical symbol that produces a result based on two values (or variables). In the following table, you can see some of the simplest operators, along with some examples to try in the JavaScript console.",style:{},id:"1940"}],style:{type:"Default"},id:"1936"},{type:"Block/Table",isBlock:!0,rows:[{cells:[{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Operator",style:{},id:"1943"}],style:{type:"Default",align:"Left"},id:"1942"}],id:"1944"},id:"1945"},{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Explanation",style:{},id:"1947"}],style:{type:"Default",align:"Left"},id:"1946"}],id:"1948"},id:"1949"},{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Symbol(s)",style:{},id:"1951"}],style:{type:"Default",align:"Left"},id:"1950"}],id:"1952"},id:"1953"},{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Example",style:{},id:"1955"}],style:{type:"Default",align:"Left"},id:"1954"}],id:"1956"},id:"1957"}],id:"1958"},{cells:[{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Addition",style:{},id:"1960"}],style:{type:"Default",align:"Left"},id:"1959"}],id:"1961"},id:"1962"},{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Add two numbers together or combine two strings.",style:{},id:"1964"}],style:{type:"Default"},id:"1963"}],id:"1965"},id:"1966"},{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"+",style:{code:!0},id:"1968"}],style:{type:"Default"},id:"1967"}],id:"1969"},id:"1970"},{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"6 + 9;",style:{code:!0},id:"1972"}],style:{type:"Default"},id:"1971"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"'Hello ' + 'world!';",style:{code:!0},id:"1975"}],style:{type:"Default"},id:"1973"}],id:"1976"},id:"1977"}],id:"1978"},{cells:[{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Subtraction, Multiplication, Division",style:{},id:"1980"}],style:{type:"Default",align:"Left"},id:"1979"}],id:"1981"},id:"1982"},{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"These do what you'd expect them to do in basic math.",style:{},id:"1984"}],style:{type:"Default"},id:"1983"}],id:"1985"},id:"1986"},{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"-",style:{code:!0},id:"1988"},{type:"Inline/Text",isBlock:!1,text:",\xa0",style:{},id:"1989"},{type:"Inline/Text",isBlock:!1,text:"*",style:{code:!0},id:"1991"},{type:"Inline/Text",isBlock:!1,text:",\xa0",style:{},id:"1992"},{type:"Inline/Text",isBlock:!1,text:"/",style:{code:!0},id:"1994"}],style:{type:"Default"},id:"1987"}],id:"1995"},id:"1996"},{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"9 - 3;",style:{code:!0},id:"1998"}],style:{type:"Default"},id:"1997"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"8 * 2; // multiply in JS is an asterisk",style:{code:!0},id:"2001"}],style:{type:"Default"},id:"1999"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"9 / 3;",style:{code:!0},id:"2004"}],style:{type:"Default"},id:"2002"}],id:"2005"},id:"2006"}],id:"2007"},{cells:[{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Assignment",style:{},id:"2009"}],style:{type:"Default",align:"Left"},id:"2008"}],id:"2010"},id:"2011"},{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"As you've seen already: this assigns a value to a variable.",style:{},id:"2013"}],style:{type:"Default"},id:"2012"}],id:"2014"},id:"2015"},{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"=",style:{code:!0},id:"2017"}],style:{type:"Default"},id:"2016"}],id:"2018"},id:"2019"},{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"let myVariable = 'Bob';",style:{code:!0},id:"2021"}],style:{type:"Default"},id:"2020"}],id:"2022"},id:"2023"}],id:"2024"},{cells:[{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Strict equality",style:{},id:"2026"}],style:{type:"Default",align:"Left"},id:"2025"}],id:"2027"},id:"2028"},{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"This performs a test to see if two values are equal. It returns a\xa0",style:{},id:"2030"},{type:"Inline/Text",isBlock:!1,text:"true",style:{code:!0},id:"2032"},{type:"Inline/Text",isBlock:!1,text:"/",style:{},id:"2033"},{type:"Inline/Text",isBlock:!1,text:"false",style:{code:!0},id:"2034"},{type:"Inline/Text",isBlock:!1,text:"\xa0(Boolean) result.",style:{},id:"2035"}],style:{type:"Default"},id:"2029"}],id:"2037"},id:"2038"},{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"===",style:{code:!0},id:"2040"}],style:{type:"Default"},id:"2039"}],id:"2041"},id:"2042"},{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"let myVariable = 3;",style:{code:!0},id:"2044"}],style:{type:"Default"},id:"2043"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"myVariable === 4;",style:{code:!0},id:"2047"}],style:{type:"Default"},id:"2045"}],id:"2048"},id:"2049"}],id:"2050"},{cells:[{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Not, Does-not-equal",style:{},id:"2052"}],style:{type:"Default",align:"Left"},id:"2051"}],id:"2053"},id:"2054"},{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"This returns the logically opposite value of what it precedes. It turns a\xa0",style:{},id:"2056"},{type:"Inline/Text",isBlock:!1,text:"true",style:{code:!0},id:"2058"},{type:"Inline/Text",isBlock:!1,text:"\xa0into a\xa0",style:{},id:"2059"},{type:"Inline/Text",isBlock:!1,text:"false",style:{code:!0},id:"2062"},{type:"Inline/Text",isBlock:!1,text:", etc.. When it is used alongside the Equality operator, the negation operator tests whether two values are\xa0",style:{},id:"2063"},{type:"Inline/Text",isBlock:!1,text:"not",style:{italic:!0},id:"2065"},{type:"Inline/Text",isBlock:!1,text:"\xa0equal.",style:{},id:"2066"}],style:{type:"Default"},id:"2055"}],id:"2068"},id:"2069"},{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"!",style:{code:!0},id:"2071"},{type:"Inline/Text",isBlock:!1,text:",\xa0",style:{},id:"2072"},{type:"Inline/Text",isBlock:!1,text:"!==",style:{code:!0},id:"2074"}],style:{type:"Default"},id:"2070"}],id:"2075"},id:"2076"},{value:{blocks:[{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:'For "Not", the basic expression is\xa0',style:{},id:"2078"},{type:"Inline/Text",isBlock:!1,text:"true",style:{code:!0},id:"2080"},{type:"Inline/Text",isBlock:!1,text:", but the comparison returns\xa0",style:{},id:"2081"},{type:"Inline/Text",isBlock:!1,text:"false",style:{code:!0},id:"2083"},{type:"Inline/Text",isBlock:!1,text:"\xa0because we negate it:",style:{},id:"2084"}],style:{type:"Default"},id:"2077"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"let myVariable = 3;",style:{code:!0},id:"2087"}],style:{type:"Default"},id:"2086"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"!(myVariable === 3);",style:{code:!0},id:"2090"}],style:{type:"Default"},id:"2088"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:'"Does-not-equal" gives basically the same result with different syntax. Here we are testing "is\xa0',style:{},id:"2092"},{type:"Inline/Text",isBlock:!1,text:"myVariable",style:{code:!0},id:"2094"},{type:"Inline/Text",isBlock:!1,text:'\xa0NOT equal to 3". This returns',style:{},id:"2095"},{type:"Inline/Text",isBlock:!1,text:"\xa0false",style:{code:!0},id:"2097"},{type:"Inline/Text",isBlock:!1,text:"\xa0because\xa0",style:{},id:"2099"},{type:"Inline/Text",isBlock:!1,text:"myVariable",style:{code:!0},id:"2102"},{type:"Inline/Text",isBlock:!1,text:"\xa0IS equal to 3:",style:{},id:"2103"}],style:{type:"Default"},id:"2091"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"let myVariable = 3;",style:{code:!0},id:"2106"}],style:{type:"Default"},id:"2105"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"myVariable !== 3;",style:{code:!0},id:"2109"}],style:{type:"Default"},id:"2107"}],id:"2110"},id:"2111"}],id:"2112"}],numColumns:4,id:"2113"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"There are a lot more operators to explore, but this is enough for now. See\xa0",style:{},id:"2115"},{type:"Inline/Text",isBlock:!1,text:"Expressions and operators",style:{underline:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators"}},id:"2117"},{type:"Inline/Text",isBlock:!1,text:"\xa0for a complete list.",style:{},id:"2118"}],style:{type:"Default"},id:"2114"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Note:\xa0Mixing data types can lead to some strange results when performing calculations. Be careful that you are referring to your variables correctly, and getting the results you expect. For example, enter\xa0",style:{},id:"2121"},{type:"Inline/Text",isBlock:!1,text:"'35' + '25'",style:{code:!0},id:"2125"},{type:"Inline/Text",isBlock:!1,text:"\xa0into your console. Why don't you get the result you expected? Because the quote marks turn the numbers into strings, so you've ended up concatenating strings rather than adding numbers. If you enter\xa0",style:{},id:"2126"},{type:"Inline/Text",isBlock:!1,text:"35 + 25",style:{code:!0},id:"2129"},{type:"Inline/Text",isBlock:!1,text:"\xa0you'll get the total of the two numbers.",style:{},id:"2130"}],style:{type:"Default"},id:"2120"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Conditionals",style:{link:{href:"https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web/JavaScript_basics#conditionals"}},id:"2133"}],style:{type:"Heading 2"},id:"2132"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Conditionals are code structures used to test if an expression returns true or not. A very common form of conditionals is the\xa0",style:{},id:"2135"},{type:"Inline/Text",isBlock:!1,text:"if...else",style:{code:!0},id:"2137"},{type:"Inline/Text",isBlock:!1,text:"\xa0statement. For example:",style:{},id:"2138"}],style:{type:"Default"},id:"2134"},{type:"Block/Code",isBlock:!0,code:'let iceCream = "chocolate";\nif (iceCream === "chocolate") {\n  alert("Yay, I love chocolate ice cream!");\n} else {\n  alert("Awwww, but chocolate is my favorite…");\n}\n',id:"2140"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"The expression inside the\xa0",style:{},id:"2142"},{type:"Inline/Text",isBlock:!1,text:"if ()",style:{code:!0},id:"2144"},{type:"Inline/Text",isBlock:!1,text:"\xa0is the test. This uses the strict equality operator (as described above) to compare the variable\xa0",style:{},id:"2145"},{type:"Inline/Text",isBlock:!1,text:"iceCream",style:{code:!0},id:"2148"},{type:"Inline/Text",isBlock:!1,text:"\xa0with the string\xa0",style:{},id:"2149"},{type:"Inline/Text",isBlock:!1,text:"chocolate",style:{code:!0},id:"2152"},{type:"Inline/Text",isBlock:!1,text:"\xa0to see if the two are equal. If this comparison returns\xa0",style:{},id:"2153"},{type:"Inline/Text",isBlock:!1,text:"true",style:{code:!0},id:"2156"},{type:"Inline/Text",isBlock:!1,text:", the first block of code runs. If the comparison is not true, the second block of code—after the\xa0",style:{},id:"2157"},{type:"Inline/Text",isBlock:!1,text:"else",style:{code:!0},id:"2159"},{type:"Inline/Text",isBlock:!1,text:"\xa0statement—runs instead.",style:{},id:"2160"}],style:{type:"Default"},id:"2141"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Functions",style:{link:{href:"https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web/JavaScript_basics#functions"}},id:"2163"}],style:{type:"Heading 2"},id:"2162"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Functions",style:{underline:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Glossary/Function"}},id:"2165"},{type:"Inline/Text",isBlock:!1,text:"\xa0are a way of packaging functionality that you wish to reuse. It's possible to define a body of code as a function that executes when you call the function name in your code. This is a good alternative to repeatedly writing the same code. You have already seen some uses of functions. For example:",style:{},id:"2166"}],style:{type:"Default"},id:"2164"},{type:"Block/Code",isBlock:!0,code:'let myVariable = document.querySelector("h1");\n',id:"2168"},{type:"Block/Code",isBlock:!0,code:'alert("hello!");\n',id:"2169"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"These functions,\xa0",style:{},id:"2171"},{type:"Inline/Text",isBlock:!1,text:"document.querySelector",style:{code:!0},id:"2173"},{type:"Inline/Text",isBlock:!1,text:"\xa0and\xa0",style:{},id:"2174"},{type:"Inline/Text",isBlock:!1,text:"alert",style:{code:!0},id:"2177"},{type:"Inline/Text",isBlock:!1,text:", are built into the browser.",style:{},id:"2178"}],style:{type:"Default"},id:"2170"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"If you see something which looks like a variable name, but it's followed by parentheses—\xa0",style:{},id:"2180"},{type:"Inline/Text",isBlock:!1,text:"()",style:{code:!0},id:"2182"},{type:"Inline/Text",isBlock:!1,text:"\xa0—it is likely a function. Functions often take\xa0",style:{},id:"2183"},{type:"Inline/Text",isBlock:!1,text:"arguments",style:{underline:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Glossary/Argument"}},id:"2186"},{type:"Inline/Text",isBlock:!1,text:": bits of data they need to do their job. Arguments go inside the parentheses, separated by commas if there is more than one argument.",style:{},id:"2187"}],style:{type:"Default"},id:"2179"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"For example, the\xa0",style:{},id:"2189"},{type:"Inline/Text",isBlock:!1,text:"alert()",style:{code:!0},id:"2191"},{type:"Inline/Text",isBlock:!1,text:"\xa0function makes a pop-up box appear inside the browser window, but we need to give it a string as an argument to tell the function what message to display.",style:{},id:"2192"}],style:{type:"Default"},id:"2188"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"You can also define your own functions. In the next example, we create a simple function which takes two numbers as arguments and multiplies them:",style:{},id:"2195"}],style:{type:"Default"},id:"2194"},{type:"Block/Code",isBlock:!0,code:"function multiply(num1, num2) {\n  let result = num1 * num2;\n  return result;\n}\n",id:"2196"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Try running this in the console; then test with several arguments. For example:",style:{},id:"2198"}],style:{type:"Default"},id:"2197"},{type:"Block/Code",isBlock:!0,code:"multiply(4, 7);\nmultiply(20, 20);\nmultiply(0.5, 3);\n",id:"2199"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Note:\xa0The\xa0",style:{},id:"2201"},{type:"Inline/Text",isBlock:!1,text:"return",style:{underline:!0,code:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/return"}},id:"2205"},{type:"Inline/Text",isBlock:!1,text:"\xa0statement tells the browser to return the\xa0",style:{},id:"2206"},{type:"Inline/Text",isBlock:!1,text:"result",style:{code:!0},id:"2209"},{type:"Inline/Text",isBlock:!1,text:"\xa0variable out of the function so it is available to use. This is necessary because variables defined inside functions are only available inside those functions. This is called variable\xa0",style:{},id:"2210"},{type:"Inline/Text",isBlock:!1,text:"scoping",style:{underline:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Glossary/Scope"}},id:"2213"},{type:"Inline/Text",isBlock:!1,text:". (Read more about\xa0",style:{},id:"2214"},{type:"Inline/Text",isBlock:!1,text:"variable scoping",style:{underline:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Grammar_and_types#variable_scope"}},id:"2216"},{type:"Inline/Text",isBlock:!1,text:".)",style:{},id:"2217"}],style:{type:"Default"},id:"2200"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Events",style:{link:{href:"https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web/JavaScript_basics#events"}},id:"2219"}],style:{type:"Heading 2"},id:"2218"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Real interactivity on a website requires event handlers. These are code structures that listen for activity in the browser, and run code in response. The most obvious example is handling the\xa0",style:{},id:"2221"},{type:"Inline/Text",isBlock:!1,text:"click event",style:{underline:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Web/API/Element/click_event"}},id:"2223"},{type:"Inline/Text",isBlock:!1,text:", which is fired by the browser when you click on something with your mouse. To demonstrate this, enter the following into your console, then click on the current webpage:",style:{},id:"2224"}],style:{type:"Default"},id:"2220"},{type:"Block/Code",isBlock:!0,code:'document.querySelector("html").addEventListener("click", function () {\n  alert("Ouch! Stop poking me!");\n});\n',id:"2225"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"There are a number of ways to attach an event handler to an element. Here we select the\xa0",style:{},id:"2227"},{type:"Inline/Text",isBlock:!1,text:"<html>",style:{underline:!0,code:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Web/HTML/Element/html"}},id:"2229"},{type:"Inline/Text",isBlock:!1,text:"\xa0element. We then call its\xa0",style:{},id:"2230"},{type:"Inline/Text",isBlock:!1,text:"addEventListener()",style:{underline:!0,code:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener"}},id:"2233"},{type:"Inline/Text",isBlock:!1,text:"\xa0function, passing in the name of the event to listen to (",style:{},id:"2234"},{type:"Inline/Text",isBlock:!1,text:"'click'",style:{code:!0},id:"2236"},{type:"Inline/Text",isBlock:!1,text:") and a function to run when the event happens.",style:{},id:"2237"}],style:{type:"Default"},id:"2226"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"The function we just passed to\xa0",style:{},id:"2239"},{type:"Inline/Text",isBlock:!1,text:"addEventListener()",style:{code:!0},id:"2241"},{type:"Inline/Text",isBlock:!1,text:"\xa0here is called an\xa0",style:{},id:"2242"},{type:"Inline/Text",isBlock:!1,text:"anonymous function",style:{italic:!0},id:"2245"},{type:"Inline/Text",isBlock:!1,text:", because it doesn't have a name. There's an alternative way of writing anonymous functions, which we call an\xa0",style:{},id:"2246"},{type:"Inline/Text",isBlock:!1,text:"arrow function",style:{italic:!0},id:"2248"},{type:"Inline/Text",isBlock:!1,text:". An arrow function uses\xa0",style:{},id:"2249"},{type:"Inline/Text",isBlock:!1,text:"() =>",style:{code:!0},id:"2251"},{type:"Inline/Text",isBlock:!1,text:"\xa0instead of\xa0",style:{},id:"2252"},{type:"Inline/Text",isBlock:!1,text:"function ()",style:{code:!0},id:"2255"},{type:"Inline/Text",isBlock:!1,text:":",style:{},id:"2256"}],style:{type:"Default"},id:"2238"},{type:"Block/Code",isBlock:!0,code:'document.querySelector("html").addEventListener("click", () => {\n  alert("Ouch! Stop poking me!");\n});\n',id:"2257"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Supercharging our example website",style:{link:{href:"https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web/JavaScript_basics#supercharging_our_example_website"}},id:"2259"}],style:{type:"Heading 2"},id:"2258"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"With this review of JavaScript basics completed (above), let's add some new features to our example site.",style:{},id:"2261"}],style:{type:"Default"},id:"2260"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Before going any further, delete the current contents of your\xa0",style:{},id:"2263"},{type:"Inline/Text",isBlock:!1,text:"main.js",style:{code:!0},id:"2265"},{type:"Inline/Text",isBlock:!1,text:'\xa0file — the bit you added earlier during the "Hello world!" example — and save the empty file. If you don\'t, the existing code will clash with the new code you are about to add.',style:{},id:"2266"}],style:{type:"Default"},id:"2262"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Adding an image changer",style:{link:{href:"https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web/JavaScript_basics#adding_an_image_changer"}},id:"2269"}],style:{type:"Heading 2"},id:"2268"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"In this section, you will learn how to use JavaScript and DOM API features to alternate the display of one of two images. This change will happen as a user clicks the displayed image.",style:{},id:"2271"}],style:{type:"Default"},id:"2270"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Choose an image you want to feature on your example site. Ideally, the image will be the same size as the image you added previously, or as close as possible.",style:{},id:"2274"}],style:{type:"Numbered List",listId:"2272"},id:"2273"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Save this image in your\xa0",style:{},id:"2276"},{type:"Inline/Text",isBlock:!1,text:"images",style:{code:!0},id:"2278"},{type:"Inline/Text",isBlock:!1,text:"\xa0folder.",style:{},id:"2279"}],style:{type:"Numbered List",listId:"2272"},id:"2275"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Rename the image\xa0",style:{},id:"2282"},{type:"Inline/Text",isBlock:!1,text:"firefox2.png",style:{italic:!0},id:"2284"},{type:"Inline/Text",isBlock:!1,text:".",style:{},id:"2285"}],style:{type:"Numbered List",listId:"2272"},id:"2281"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Add the following JavaScript code to your\xa0",style:{},id:"2287"},{type:"Inline/Text",isBlock:!1,text:"main.js",style:{code:!0},id:"2289"},{type:"Inline/Text",isBlock:!1,text:"\xa0file.",style:{},id:"2290"}],style:{type:"Numbered List",listId:"2272"},id:"2286"},{type:"Block/Code",isBlock:!0,code:'const myImage = document.querySelector("img");\n\nmyImage.onclick = () => {\n  const mySrc = myImage.getAttribute("src");\n  if (mySrc === "images/firefox-icon.png") {\n    myImage.setAttribute("src", "images/firefox2.png");\n  } else {\n    myImage.setAttribute("src", "images/firefox-icon.png");\n  }\n};\n',id:"2292"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Save all files and load\xa0",style:{},id:"2294"},{type:"Inline/Text",isBlock:!1,text:"index.html",style:{code:!0},id:"2296"},{type:"Inline/Text",isBlock:!1,text:"\xa0in the browser. Now when you click the image, it should change to the other one.",style:{},id:"2297"}],style:{type:"Numbered List",listId:"2272"},id:"2293"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"This is what happened. You stored a reference to your\xa0",style:{},id:"2300"},{type:"Inline/Text",isBlock:!1,text:"<img>",style:{underline:!0,code:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Web/HTML/Element/img"}},id:"2302"},{type:"Inline/Text",isBlock:!1,text:"\xa0element in\xa0",style:{},id:"2303"},{type:"Inline/Text",isBlock:!1,text:"myImage",style:{code:!0},id:"2306"},{type:"Inline/Text",isBlock:!1,text:". Next, you made its\xa0",style:{},id:"2307"},{type:"Inline/Text",isBlock:!1,text:"onclick",style:{code:!0},id:"2309"},{type:"Inline/Text",isBlock:!1,text:'\xa0event handler property equal to a function with no name (an "anonymous" function). So every time this element is clicked:',style:{},id:"2310"}],style:{type:"Default"},id:"2299"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"The code retrieves the value of the image's\xa0",style:{},id:"2314"},{type:"Inline/Text",isBlock:!1,text:"src",style:{code:!0},id:"2316"},{type:"Inline/Text",isBlock:!1,text:"\xa0attribute.",style:{},id:"2317"}],style:{type:"Numbered List",listId:"2312"},id:"2313"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"The code uses a conditional to check if the\xa0",style:{},id:"2320"},{type:"Inline/Text",isBlock:!1,text:"src",style:{code:!0},id:"2322"},{type:"Inline/Text",isBlock:!1,text:"\xa0value is equal to the path of the original image:",style:{},id:"2323"}],style:{type:"Numbered List",listId:"2312"},id:"2319"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"If it is, the code changes the\xa0",style:{},id:"2327"},{type:"Inline/Text",isBlock:!1,text:"src",style:{code:!0},id:"2329"},{type:"Inline/Text",isBlock:!1,text:"\xa0value to the path of the second image, forcing the other image to be loaded inside the\xa0",style:{},id:"2330"},{type:"Inline/Text",isBlock:!1,text:"<img>",style:{underline:!0,code:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Web/HTML/Element/img"}},id:"2333"},{type:"Inline/Text",isBlock:!1,text:"\xa0element.",style:{},id:"2334"}],style:{type:"Numbered List",listId:"2325",indentLevel:1},id:"2326"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"If it isn't (meaning it must already have changed), the\xa0",style:{},id:"2337"},{type:"Inline/Text",isBlock:!1,text:"src",style:{code:!0},id:"2339"},{type:"Inline/Text",isBlock:!1,text:"\xa0value swaps back to the original image path, to the original state.",style:{},id:"2340"}],style:{type:"Numbered List",listId:"2325",indentLevel:1},id:"2336"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Adding a personalized welcome message",style:{link:{href:"https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web/JavaScript_basics#adding_a_personalized_welcome_message"}},id:"2343"}],style:{type:"Heading 2"},id:"2342"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Next, let's change the page title to a personalized welcome message when the user first visits the site. This welcome message will persist. Should the user leave the site and return later, we will save the message using the\xa0",style:{},id:"2345"},{type:"Inline/Text",isBlock:!1,text:"Web Storage API",style:{underline:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API"}},id:"2347"},{type:"Inline/Text",isBlock:!1,text:". We will also include an option to change the user, and therefore, the welcome message.",style:{},id:"2348"}],style:{type:"Default"},id:"2344"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"In\xa0",style:{},id:"2351"},{type:"Inline/Text",isBlock:!1,text:"index.html",style:{code:!0},id:"2353"},{type:"Inline/Text",isBlock:!1,text:", add the following line just before the\xa0",style:{},id:"2354"},{type:"Inline/Text",isBlock:!1,text:"<script>",style:{underline:!0,code:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script"}},id:"2356"},{type:"Inline/Text",isBlock:!1,text:"\xa0element:",style:{},id:"2357"}],style:{type:"Numbered List",listId:"2349"},id:"2350"},{type:"Block/Code",isBlock:!0,code:"<button>Change user</button>\n",id:"2359"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"In\xa0",style:{},id:"2361"},{type:"Inline/Text",isBlock:!1,text:"main.js",style:{code:!0},id:"2363"},{type:"Inline/Text",isBlock:!1,text:", place the following code at the bottom of the file, exactly as it is written. This takes references to the new button and the heading, storing each inside variables:",style:{},id:"2364"}],style:{type:"Numbered List",listId:"2349"},id:"2360"},{type:"Block/Code",isBlock:!0,code:'let myButton = document.querySelector("button");\nlet myHeading = document.querySelector("h1");\n',id:"2365"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Add the following function to set the personalized greeting. This won't do anything yet, but this will change soon.",style:{},id:"2367"}],style:{type:"Numbered List",listId:"2349"},id:"2366"},{type:"Block/Code",isBlock:!0,code:'function setUserName() {\n  const myName = prompt("Please enter your name.");\n  localStorage.setItem("name", myName);\n  myHeading.textContent = `Mozilla is cool, ${myName}`;\n}\n',id:"2368"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"The\xa0",style:{},id:"2370"},{type:"Inline/Text",isBlock:!1,text:"setUserName()",style:{code:!0},id:"2372"},{type:"Inline/Text",isBlock:!1,text:"\xa0function contains a\xa0",style:{},id:"2373"},{type:"Inline/Text",isBlock:!1,text:"prompt()",style:{underline:!0,code:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Web/API/Window/prompt"}},id:"2376"},{type:"Inline/Text",isBlock:!1,text:"\xa0function, which displays a dialog box, similar to\xa0",style:{},id:"2377"},{type:"Inline/Text",isBlock:!1,text:"alert()",style:{code:!0},id:"2380"},{type:"Inline/Text",isBlock:!1,text:". This\xa0",style:{},id:"2381"},{type:"Inline/Text",isBlock:!1,text:"prompt()",style:{code:!0},id:"2383"},{type:"Inline/Text",isBlock:!1,text:"\xa0function does more than\xa0",style:{},id:"2384"},{type:"Inline/Text",isBlock:!1,text:"alert()",style:{code:!0},id:"2387"},{type:"Inline/Text",isBlock:!1,text:", asking the user to enter data, and storing it in a variable after the user clicks\xa0",style:{},id:"2388"},{type:"Inline/Text",isBlock:!1,text:"OK.",style:{italic:!0},id:"2390"},{type:"Inline/Text",isBlock:!1,text:"\xa0In this case, we are asking the user to enter a name. Next, the code calls on an API\xa0",style:{},id:"2391"},{type:"Inline/Text",isBlock:!1,text:"localStorage",style:{code:!0},id:"2394"},{type:"Inline/Text",isBlock:!1,text:", which allows us to store data in the browser and retrieve it later. We use localStorage's\xa0",style:{},id:"2395"},{type:"Inline/Text",isBlock:!1,text:"setItem()",style:{code:!0},id:"2397"},{type:"Inline/Text",isBlock:!1,text:"\xa0function to create and store a data item called\xa0",style:{},id:"2398"},{type:"Inline/Text",isBlock:!1,text:"'name'",style:{code:!0},id:"2401"},{type:"Inline/Text",isBlock:!1,text:", setting its value to the\xa0",style:{},id:"2402"},{type:"Inline/Text",isBlock:!1,text:"myName",style:{code:!0},id:"2404"},{type:"Inline/Text",isBlock:!1,text:"\xa0variable which contains the user's entry for the name. Finally, we set the\xa0",style:{},id:"2405"},{type:"Inline/Text",isBlock:!1,text:"textContent",style:{code:!0},id:"2408"},{type:"Inline/Text",isBlock:!1,text:"\xa0of the heading to a string, plus the user's newly stored name.",style:{},id:"2409"}],style:{type:"Default",indentLevel:1},id:"2369"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Add the following condition block. We could call this initialization code, as it structures the app when it first loads.",style:{},id:"2412"}],style:{type:"Numbered List",listId:"2349"},id:"2411"},{type:"Block/Code",isBlock:!0,code:'if (!localStorage.getItem("name")) {\n  setUserName();\n} else {\n  const storedName = localStorage.getItem("name");\n  myHeading.textContent = `Mozilla is cool, ${storedName}`;\n}\n',id:"2413"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"This first line of this block uses the negation operator (logical NOT, represented by the\xa0",style:{},id:"2415"},{type:"Inline/Text",isBlock:!1,text:"!",style:{code:!0},id:"2417"},{type:"Inline/Text",isBlock:!1,text:") to check whether the\xa0",style:{},id:"2418"},{type:"Inline/Text",isBlock:!1,text:"name",style:{code:!0},id:"2420"},{type:"Inline/Text",isBlock:!1,text:"\xa0data exists. If not, the\xa0",style:{},id:"2421"},{type:"Inline/Text",isBlock:!1,text:"setUserName()",style:{code:!0},id:"2424"},{type:"Inline/Text",isBlock:!1,text:"\xa0function runs to create it. If it exists (that is, the user set a user name during a previous visit), we retrieve the stored name using\xa0",style:{},id:"2425"},{type:"Inline/Text",isBlock:!1,text:"getItem()",style:{code:!0},id:"2428"},{type:"Inline/Text",isBlock:!1,text:"\xa0and set the\xa0",style:{},id:"2429"},{type:"Inline/Text",isBlock:!1,text:"textContent",style:{code:!0},id:"2432"},{type:"Inline/Text",isBlock:!1,text:"\xa0of the heading to a string, plus the user's name, as we did inside\xa0",style:{},id:"2433"},{type:"Inline/Text",isBlock:!1,text:"setUserName()",style:{code:!0},id:"2436"},{type:"Inline/Text",isBlock:!1,text:".",style:{},id:"2437"}],style:{type:"Default",indentLevel:1},id:"2414"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Put this\xa0",style:{},id:"2439"},{type:"Inline/Text",isBlock:!1,text:"onclick",style:{code:!0},id:"2441"},{type:"Inline/Text",isBlock:!1,text:"\xa0event handler (below) on the button. When clicked,\xa0",style:{},id:"2442"},{type:"Inline/Text",isBlock:!1,text:"setUserName()",style:{code:!0},id:"2445"},{type:"Inline/Text",isBlock:!1,text:"\xa0runs. This allows the user to enter a different name by pressing the button.",style:{},id:"2446"}],style:{type:"Numbered List",listId:"2349"},id:"2438"},{type:"Block/Code",isBlock:!0,code:"myButton.onclick = () => {\n  setUserName();\n};\n",id:"2448"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"A user name of null?",style:{link:{href:"https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web/JavaScript_basics#a_user_name_of_null"}},id:"2450"}],style:{type:"Heading 2"},id:"2449"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"When you run the example and get the dialog box that prompts you to enter your user name, try pressing the\xa0",style:{},id:"2452"},{type:"Inline/Text",isBlock:!1,text:"Cancel",style:{italic:!0},id:"2454"},{type:"Inline/Text",isBlock:!1,text:"\xa0button. You should end up with a title that reads\xa0",style:{},id:"2455"},{type:"Inline/Text",isBlock:!1,text:"Mozilla is cool, null",style:{italic:!0},id:"2458"},{type:"Inline/Text",isBlock:!1,text:". This happens because—when you cancel the prompt—the value is set as\xa0",style:{},id:"2459"},{type:"Inline/Text",isBlock:!1,text:"null",style:{underline:!0,code:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/null"}},id:"2461"},{type:"Inline/Text",isBlock:!1,text:".\xa0",style:{},id:"2462"},{type:"Inline/Text",isBlock:!1,text:"Null",style:{italic:!0},id:"2464"},{type:"Inline/Text",isBlock:!1,text:"\xa0is a special value in JavaScript that refers to the absence of a value.",style:{},id:"2465"}],style:{type:"Default"},id:"2451"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Also, try clicking\xa0",style:{},id:"2468"},{type:"Inline/Text",isBlock:!1,text:"OK",style:{italic:!0},id:"2470"},{type:"Inline/Text",isBlock:!1,text:"\xa0without entering a name. You should end up with a title that reads\xa0",style:{},id:"2471"},{type:"Inline/Text",isBlock:!1,text:"Mozilla is cool,",style:{italic:!0},id:"2474"},{type:"Inline/Text",isBlock:!1,text:"\xa0for fairly obvious reasons.",style:{},id:"2475"}],style:{type:"Default"},id:"2467"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"To avoid these problems, you could check that the user hasn't entered a blank name. Update your\xa0",style:{},id:"2478"},{type:"Inline/Text",isBlock:!1,text:"setUserName()",style:{code:!0},id:"2480"},{type:"Inline/Text",isBlock:!1,text:"\xa0function to this:",style:{},id:"2481"}],style:{type:"Default"},id:"2477"},{type:"Block/Code",isBlock:!0,code:'function setUserName() {\n  const myName = prompt("Please enter your name.");\n  if (!myName) {\n    setUserName();\n  } else {\n    localStorage.setItem("name", myName);\n    myHeading.textContent = `Mozilla is cool, ${myName}`;\n  }\n}\n',id:"2483"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"In human language, this means: If\xa0",style:{},id:"2485"},{type:"Inline/Text",isBlock:!1,text:"myName",style:{code:!0},id:"2487"},{type:"Inline/Text",isBlock:!1,text:"\xa0has no value, run\xa0",style:{},id:"2488"},{type:"Inline/Text",isBlock:!1,text:"setUserName()",style:{code:!0},id:"2491"},{type:"Inline/Text",isBlock:!1,text:"\xa0again from the start. If it does have a value (if the above statement is not true), then store the value in\xa0",style:{},id:"2492"},{type:"Inline/Text",isBlock:!1,text:"localStorage",style:{code:!0},id:"2495"},{type:"Inline/Text",isBlock:!1,text:"\xa0and set it as the heading's text.",style:{},id:"2496"}],style:{type:"Default"},id:"2484"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Conclusion",style:{link:{href:"https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web/JavaScript_basics#conclusion"}},id:"2499"}],style:{type:"Heading 2"},id:"2498"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"If you have followed all the instructions in this article, you should end up with a page that looks something like the image below. You can also\xa0",style:{},id:"2501"},{type:"Inline/Text",isBlock:!1,text:"view our version",style:{underline:!0,link:{href:"https://mdn.github.io/beginner-html-site-scripted/"}},id:"2503"},{type:"Inline/Text",isBlock:!1,text:".",style:{},id:"2504"}],style:{type:"Default"},id:"2500"},{type:"Block/Image",isBlock:!0,src:"https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web/JavaScript_basics/website-screen-scripted.png",caption:"Final look of HTML page after creating elements: a header, large centered logo, content, and a button",id:"2505"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"If you get stuck, you can compare your work with our\xa0",style:{},id:"2507"},{type:"Inline/Text",isBlock:!1,text:"finished example code on GitHub",style:{underline:!0,link:{href:"https://github.com/mdn/beginner-html-site-scripted/blob/gh-pages/scripts/main.js"}},id:"2509"},{type:"Inline/Text",isBlock:!1,text:".",style:{},id:"2510"}],style:{type:"Default"},id:"2506"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"We have just scratched the surface of JavaScript. If you enjoyed playing, and wish to go further, take advantage of the resources listed below.",style:{},id:"2512"}],style:{type:"Default"},id:"2511"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"See also",style:{link:{href:"https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web/JavaScript_basics#see_also"}},id:"2514"}],style:{type:"Heading 2"},id:"2513"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Dynamic client-side scripting with JavaScript",style:{underline:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Learn/JavaScript"}},id:"2516"}],style:{type:"Default"},id:"2515"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Dive into JavaScript in much more detail.",style:{},id:"2518"}],style:{type:"Default"},id:"2517"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Learn JavaScript",style:{underline:!0,link:{href:"https://learnjavascript.online/"}},id:"2520"}],style:{type:"Default"},id:"2519"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"This is an excellent resource for aspiring web developers! Learn JavaScript in an interactive environment, with short lessons and interactive tests, guided by an automated assessment. The first 40 lessons are free. The complete course is available for a small one-time payment.",style:{},id:"2522"}],style:{type:"Default"},id:"2521"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"In this module",style:{link:{href:"https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web/JavaScript_basics#in_this_module"}},id:"2524"}],style:{type:"Heading 2"},id:"2523"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Installing basic software",style:{underline:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web/Installing_basic_software"}},id:"2527"}],style:{type:"Bullet List",listId:"2525"},id:"2526"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"What will your website look like?",style:{underline:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web/What_will_your_website_look_like"}},id:"2529"}],style:{type:"Bullet List",listId:"2525"},id:"2528"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Dealing with files",style:{underline:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web/Dealing_with_files"}},id:"2531"}],style:{type:"Bullet List",listId:"2525"},id:"2530"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"HTML basics",style:{underline:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web/HTML_basics"}},id:"2533"}],style:{type:"Bullet List",listId:"2525"},id:"2532"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"CSS basics",style:{underline:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web/CSS_basics"}},id:"2535"}],style:{type:"Bullet List",listId:"2525"},id:"2534"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"JavaScript basics",style:{link:{href:"https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web/JavaScript_basics"}},id:"2537"}],style:{type:"Bullet List",listId:"2525"},id:"2536"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Publishing your website",style:{underline:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web/Publishing_your_website"}},id:"2539"}],style:{type:"Bullet List",listId:"2525"},id:"2538"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"How the web works",style:{underline:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web/How_the_Web_works"}},id:"2541"}],style:{type:"Bullet List",listId:"2525"},id:"2540"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Found a content problem with this page?",style:{},id:"2543"}],style:{type:"Heading 2"},id:"2542"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Edit the page\xa0",style:{},id:"2546"},{type:"Inline/Text",isBlock:!1,text:"on GitHub",style:{underline:!0,link:{href:"https://github.com/mdn/content/edit/main/files/en-us/learn/getting_started_with_the_web/javascript_basics/index.md"}},id:"2548"},{type:"Inline/Text",isBlock:!1,text:".",style:{},id:"2549"}],style:{type:"Bullet List",listId:"2544"},id:"2545"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Report the\xa0",style:{},id:"2551"},{type:"Inline/Text",isBlock:!1,text:"content issue",style:{underline:!0,link:{href:"https://github.com/mdn/content/issues/new?template=page-report.yml&mdn-url=https%3A%2F%2Fdeveloper.mozilla.org%2Fen-US%2Fdocs%2FLearn%2FGetting_started_with_the_web%2FJavaScript_basics&metadata=%3C%21--+Do+not+make+changes+below+this+line+--%3E%0A%3Cdetails%3E%0A%3Csummary%3EPage+report+details%3C%2Fsummary%3E%0A%0A*+Folder%3A+%60en-us%2Flearn%2Fgetting_started_with_the_web%2Fjavascript_basics%60%0A*+MDN+URL%3A+https%3A%2F%2Fdeveloper.mozilla.org%2Fen-US%2Fdocs%2FLearn%2FGetting_started_with_the_web%2FJavaScript_basics%0A*+GitHub+URL%3A+https%3A%2F%2Fgithub.com%2Fmdn%2Fcontent%2Fblob%2Fmain%2Ffiles%2Fen-us%2Flearn%2Fgetting_started_with_the_web%2Fjavascript_basics%2Findex.md%0A*+Last+commit%3A+https%3A%2F%2Fgithub.com%2Fmdn%2Fcontent%2Fcommit%2Fb0acf7e8607b12f618d1d690841ee6dc8b19671a%0A*+Document+last+modified%3A+2023-01-02T23%3A44%3A35.000Z%0A%0A%3C%2Fdetails%3E"}},id:"2553"},{type:"Inline/Text",isBlock:!1,text:".",style:{},id:"2554"}],style:{type:"Bullet List",listId:"2544"},id:"2550"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"View the source\xa0",style:{},id:"2556"},{type:"Inline/Text",isBlock:!1,text:"on GitHub",style:{underline:!0,link:{href:"https://github.com/mdn/content/blob/main/files/en-us/learn/getting_started_with_the_web/javascript_basics/index.md?plain=1"}},id:"2558"},{type:"Inline/Text",isBlock:!1,text:".",style:{},id:"2559"}],style:{type:"Bullet List",listId:"2544"},id:"2555"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"Want to get more involved? Learn\xa0",style:{},id:"2561"},{type:"Inline/Text",isBlock:!1,text:"how to contribute",style:{underline:!0,link:{href:"https://github.com/mdn/content/blob/main/CONTRIBUTING.md"}},id:"2563"},{type:"Inline/Text",isBlock:!1,text:".",style:{},id:"2564"}],style:{type:"Default"},id:"2560"},{type:"Block/Paragraph",isBlock:!1,children:[{type:"Inline/Text",isBlock:!1,text:"This page was last modified on\xa0Jan 3, 2023\xa0by\xa0",style:{},id:"2566"},{type:"Inline/Text",isBlock:!1,text:"MDN contributors",style:{underline:!0,link:{href:"https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web/JavaScript_basics/contributors.txt"}},id:"2572"},{type:"Inline/Text",isBlock:!1,text:".",style:{},id:"2573"}],style:{type:"Default"},id:"2565"}],id:"2574"};

  return (
    <div className={['page', roboto.className].join(' ')}>
      <div className="page__inner">
        <main className="editor-wrapper">
          <ReactEditor initialValue={initialValue as EditorValue} makeId={id} />
        </main>
      </div>
    </div>
  );
}
