'use client';

(function () {
  const consoleError = console.error;
  const SUPPRESSED_WARNINGS = [
    'Support for defaultProps will be removed from function components in a future major release',
    'Failed %s type: %s%s',
  ];
  console.error = function filterWarnings(msg, ...args) {
    if (
      !SUPPRESSED_WARNINGS.some(
        (entry) => typeof msg === 'string' && msg.includes(entry),
      )
    ) {
      consoleError(msg, ...args);
    }
  };
})();

import React, {
  cloneElement,
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Poppins, Fira_Code } from '@next/font/google';
import { Tooltip } from '@/Tooltip';
import { createDraft, finishDraft } from 'immer';
import { WritableDraft } from 'immer/dist/internal';
import { flushSync } from 'react-dom';
import MonacoEditor, { loader } from '@monaco-editor/react';
import monacoTheme from './monacoTheme.json';
import type {
  Options as PrettierOptions,
  Plugin as PrettierPlugin,
} from 'prettier';
import { v4 as uuidv4 } from 'uuid';
import Highlight, { PrismTheme, defaultProps } from 'prism-react-renderer';
import dynamic from 'next/dynamic';

const mainFont = Poppins({
  weight: ['300', '600'],
  style: ['normal', 'italic'],
  subsets: ['latin'],
  display: 'block',
});
const codeFont = Fira_Code({
  weight: '400',
  style: 'normal',
  subsets: ['latin'],
  display: 'block',
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
  src: string;
  caption: string;
  id: string;
}

enum CodeBlockLanguage {
  Js = 'javascript',
  Json = 'json',
  Ts = 'typescript',
  Html = 'html',
  Css = 'css',
  Vue = 'vue',
  PlainText = 'plaintext',
}

interface CodeBlockNode {
  type: BlockNodeType.Code;
  code: string;
  language: CodeBlockLanguage;
  id: string;
}

enum ParagraphStyleType {
  Default = 'Default',
  Heading2 = 'Heading 2',
  Heading1 = 'Heading 1',
  Heading3 = 'Heading 3',
  Heading4 = 'Heading 4',
  BlockQuote = 'BlockQuote',
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
interface Heading4ParagraphStyle extends ParagraphStyleBase {
  type: ParagraphStyleType.Heading4;
}
interface BlockQuote extends ParagraphStyleBase {
  type: ParagraphStyleType.BlockQuote;
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
  | Heading4ParagraphStyle
  | BlockQuote
  | BulletListParagraphStyle
  | NumberedListParagraphStyle;

interface ParagraphNode {
  type: BlockNodeType.Paragraph;
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
  text: string;
  style: TextStyle;
  id: string;
}

type BlockNode = ImageNode | TableNode | CodeBlockNode | ParagraphNode;
type InlineNode = TextNode;

enum PushStateAction {
  Unique = 'Unique',
  Insert = 'Insert',
  Delete = 'Delete',
  Selection = 'Selection',
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
function makeHeading4Paragraph(
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
function makeBlockQuoteParagraph(
  children: InlineNode[],
  id: string,
  styleBase?: ParagraphStyleBase,
): ParagraphNode {
  return makeParagraph(
    children,
    { type: ParagraphStyleType.BlockQuote, ...styleBase },
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
  language: CodeBlockLanguage,
  id: string,
): CodeBlockNode {
  return {
    type: BlockNodeType.Code,
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
    src,
    caption,
    id,
  };
}

function makeText(text: string, style: TextStyle, id: string): TextNode {
  return {
    type: InlineNodeType.Text,
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
}
function ReactTableNode_({
  value,
  selectedCells,
}: ReactTableNodeProps & { selectedCells: string[] }): JSX.Element {
  return (
    <div
      className="table-container"
      data-family={EditorFamilyType.Block}
      data-type={BlockNodeType.Table}
      data-id={value.id}
    >
      <table className="block-table">
        <tbody className="block-table__tbody">
          {value.rows.map((row) => {
            return (
              <tr className="block-table__tr" key={row.id}>
                {row.cells.map((cell, idx) => {
                  return (
                    <td
                      key={cell.id}
                      className={[
                        selectedCells.includes(cell.value.id)
                          ? 'selected'
                          : selectedCells.length > 0 && 'not-selected',
                        'block-table__td',
                      ]
                        .filter(Boolean)
                        .join(' ')}
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
  return <ReactTableNode_m value={value} selectedCells={selectedCells} />;
}

interface ReactBlockImageNodeProps {
  value: ImageNode;
}
function ReactBlockImageNode_({
  value,
  isSelected,
}: ReactBlockImageNodeProps & { isSelected: boolean }): JSX.Element {
  const queueCommand = useContext(QueueCommandContext);
  const editorId = useContext(EditorIdContext);
  return (
    <div
      className="img-container"
      data-family={EditorFamilyType.Block}
      data-type={BlockNodeType.Image}
      data-id={value.id}
    >
      <span className="block-placeholder-br">
        <br />
      </span>
      <div
        contentEditable={false}
        onClick={() => {
          queueCommand({
            type: CommandType.Selection,
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
          });
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={['img', isSelected && 'img--selected']
            .filter(Boolean)
            .join(' ')}
          src={value.src}
          alt={value.caption}
        />
      </div>
    </div>
  );
}
const ReactBlockImageNode_m = memo(ReactBlockImageNode_, (prev, cur) => {
  return prev.value === cur.value && prev.isSelected === cur.isSelected;
});
function ReactBlockImageNode({ value }: ReactBlockImageNodeProps): JSX.Element {
  const selectedBlocks = useContext(SelectedBlocksContext);
  const isSelected = selectedBlocks.includes(value.id);
  return <ReactBlockImageNode_m value={value} isSelected={isSelected} />;
}

const prismTheme: PrismTheme = {
  plain: {
    color: '#bfc7d5',
    backgroundColor: '#292d3e',
  },
  styles: [
    {
      types: ['comment'],
      style: {
        color: 'rgb(105, 112, 152)',
        fontStyle: 'italic',
      },
    },
    {
      types: ['string'],
      style: {
        color: 'rgb(195, 232, 141)',
      },
    },
    {
      types: ['number'],
      style: {
        color: '#b5cea8',
      },
    },
    {
      types: ['builtin', 'char', 'constant', 'function'],
      style: {
        color: 'rgb(130, 170, 255)',
      },
    },
    {
      types: ['class-name', 'maybe-class-name', 'known-class-name'],
      style: {
        color: '#3dc9b0',
      },
    },
    {
      types: ['punctuation', 'selector'],
      style: {
        color: 'rgb(199, 146, 234)',
      },
    },
    {
      types: ['variable', 'attr-name'],
      style: {
        color: 'rgb(255, 203, 107)',
      },
    },
    {
      types: ['tag'],
      style: {
        color: 'rgb(255, 85, 114)',
      },
    },
    {
      types: ['operator'],
      style: {
        color: 'rgb(137, 221, 255)',
      },
    },
    {
      types: ['boolean'],
      style: {
        color: 'rgb(255, 88, 116)',
      },
    },
    {
      types: ['keyword'],
      style: {
        color: '#C792EA',
        fontStyle: 'italic',
      },
    },
    {
      types: ['doctype'],
      style: {
        color: 'rgb(199, 146, 234)',
        fontStyle: 'italic',
      },
    },
    {
      types: ['namespace'],
      style: {
        color: 'rgb(178, 204, 214)',
      },
    },
    {
      types: ['url'],
      style: {
        color: 'rgb(221, 221, 221)',
      },
    },
  ],
};

let useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface ReactCodeBlockNodeProps {
  value: CodeBlockNode;
}

function ReactCodeBlockNode_({
  value,
  isSelected,
}: ReactCodeBlockNodeProps & {
  isSelected: boolean;
}): JSX.Element {
  let editorRef =
    useRef<import('monaco-editor').editor.IStandaloneCodeEditor>();
  const [height, setHeight] = useState(0);
  const callback = useRef<any>();
  const queueCommand = useContext(QueueCommandContext);
  const editorId = useContext(EditorIdContext);
  callback.current = (code: string) => {
    if (code === value.code) {
      return;
    }
    queueCommand({
      type: CommandType.Input,
      selection: {
        type: SelectionType.Block,
        editorId: editorId,
        start: {
          type: BlockSelectionPointType.OtherBlock,
          blockId: value.id,
        },
        end: {
          type: BlockSelectionPointType.OtherBlock,
          blockId: value.id,
        },
      },
      inputType: 'x_updateCodeBlock_Code',
      data: {
        type: DataTransferType.Rich,
        value: makeEditorValue(
          [makeCodeBlock(code, value.language, value.id)],
          '',
        ),
      },
    });
  };
  const isLoading = height === 0;
  const [isClient, setIsClient] = useState(false);
  useEffect(() => {
    setIsClient(true);
  }, []);
  const loadingInner =
    isLoading && value.language !== CodeBlockLanguage.PlainText ? (
      <Highlight
        {...defaultProps}
        code={value.code}
        theme={prismTheme}
        language={
          (
            {
              [CodeBlockLanguage.Css]: 'css',
              [CodeBlockLanguage.Html]: 'markup',
              [CodeBlockLanguage.Js]: 'jsx',
              [CodeBlockLanguage.Json]: 'json',
              [CodeBlockLanguage.Ts]: 'tsx',
              [CodeBlockLanguage.Vue]: 'markup',
            } as const
          )[value.language]
        }
      >
        {({ className, style, tokens, getLineProps, getTokenProps }) => (
          <table
            style={omit(style, ['backgroundColor'])}
            className="code-block-container__table"
            aria-hidden="true"
          >
            <tbody>
              {tokens.map((line, i) => (
                <tr key={i}>
                  <td className="code-block-container__line-number">{i + 1}</td>
                  <td className="code-block-container__line-code">
                    {line.map((token, key) => (
                      <span
                        {...omit(getTokenProps({ token, key }), ['key'])}
                        key={key}
                      />
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Highlight>
    ) : (
      <table className="code-block-container__table" aria-hidden="true">
        <tbody>
          {value.code.split('\n').map((lineCode, i) => (
            <tr key={i}>
              <td className="code-block-container__line-number">{i + 1}</td>
              <td className="code-block-container__line-code">{lineCode}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  function switchLang(lang: CodeBlockLanguage): void {
    if (lang === value.language) {
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
      inputType: 'x_updateCodeBlock_Lang',
      data: {
        type: DataTransferType.Rich,
        value: makeEditorValue([makeCodeBlock(value.code, lang, value.id)], ''),
      },
    });
  }
  useIsomorphicLayoutEffect(() => {
    if (editorRef.current) {
      // @ts-expect-error
      editorRef.current.getModel()!._isVue =
        value.language === CodeBlockLanguage.Vue;
    }
  });
  const langOptions: Record<CodeBlockLanguage, string> = {
    [CodeBlockLanguage.Css]: 'CSS',
    [CodeBlockLanguage.Html]: 'HTML',
    [CodeBlockLanguage.Js]: 'Javascript',
    [CodeBlockLanguage.Json]: 'JSON',
    [CodeBlockLanguage.Ts]: 'Typescript',
    [CodeBlockLanguage.Vue]: 'Vue JS',
    [CodeBlockLanguage.PlainText]: 'Plain Text',
  };
  const CopyState$AllowCopy = 0;
  const CopyState$CopySuccess = 1;
  const CopyState$CopyFail = 2;
  const { 0: copyState, 1: setCopyState } = useState<
    | typeof CopyState$AllowCopy
    | typeof CopyState$CopySuccess
    | typeof CopyState$CopyFail
  >(CopyState$AllowCopy);
  const onCopyButtonClick = () => {
    navigator.clipboard.writeText(value.code).then(
      () => {
        setCopyState(CopyState$CopySuccess);
      },
      () => setCopyState(CopyState$CopyFail),
    );
  };
  useEffect(() => {
    if (copyState === CopyState$AllowCopy) {
      return;
    }
    const delay = copyState === CopyState$CopyFail ? 2000 : 1000;
    const timeoutHandle = setTimeout(() => {
      setCopyState(CopyState$AllowCopy);
    }, delay);
    return () => {
      clearTimeout(timeoutHandle);
    };
  }, [copyState, setCopyState]);
  const [isFocused, setIsFocused] = useState(false);
  return (
    <pre
      className={[
        'code-block-container',
        !isLoading && 'code-block-container--loaded',
        isSelected && 'code-block-container--selected',
      ]
        .filter(Boolean)
        .join(' ')}
      style={
        {
          '--bg-color': prismTheme.plain.backgroundColor,
        } as React.CSSProperties
      }
      data-family={EditorFamilyType.Block}
      data-type={BlockNodeType.Code}
      data-id={value.id}
    >
      <span className="block-placeholder-br">
        <br />
      </span>
      <div contentEditable={false}>
        <button
          type="button"
          className="code-block-container__copy-button"
          aria-label="Copy Code to Clipboard"
          title="Copy Code to Clipboard"
          aria-hidden="true"
          disabled={copyState !== CopyState$AllowCopy}
          tabIndex={-1}
          onClick={onCopyButtonClick}
        >
          {copyState === CopyState$AllowCopy
            ? 'Copy'
            : copyState === CopyState$CopySuccess
            ? 'Copied'
            : 'Copy Failed'}
        </button>
        <div className="code-block-container__lang-select-container">
          <select
            className="code-block-container__lang-select-container__select"
            value={value.language}
            tabIndex={-1}
            onChange={(event) => {
              event.preventDefault();
              switchLang(event.target.value as CodeBlockLanguage);
            }}
          >
            {Object.entries(langOptions).map(([lang, langDisplayText]) => (
              <option value={lang} key={lang}>
                {langDisplayText}
              </option>
            ))}
          </select>
        </div>
        <code className="code-block-container__code">
          {isLoading && (
            <span className={'code-block-container__accessibility-hidden-text'}>
              {value.code}
            </span>
          )}
          {!isClient ? (
            loadingInner
          ) : (
            <MonacoEditor
              defaultPath={`file:///${value.id}.${
                {
                  [CodeBlockLanguage.Css]: 'css',
                  [CodeBlockLanguage.Html]: 'html',
                  [CodeBlockLanguage.Js]: 'jsx',
                  [CodeBlockLanguage.Json]: 'json',
                  [CodeBlockLanguage.Ts]: 'tsx',
                  [CodeBlockLanguage.Vue]: 'vue',
                  [CodeBlockLanguage.PlainText]: 'txt',
                }[value.language]
              }`}
              loading={loadingInner}
              className={
                isFocused
                  ? undefined
                  : 'code-block-container__monaco--not-focused'
              }
              language={
                value.language === CodeBlockLanguage.Vue
                  ? CodeBlockLanguage.Html
                  : value.language
              }
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
                renderLineHighlightOnlyWhenFocus: true,
                scrollbar: {
                  handleMouseWheel: false,
                },
                fontSize: 16,
                fontFamily: codeFont.style.fontFamily,
                fontWeight: '400',
                fontLigatures: true,
                tabIndex: -1,
                lineNumbersMinChars: 0,
              }}
              theme={'my-theme'}
              onMount={(editor) => {
                // @ts-expect-error
                editor.getModel()!._isVue =
                  value.language === CodeBlockLanguage.Vue;
                editorRef.current = editor;
                function updateHeight(): void {
                  const contentHeight = editor.getContentHeight();
                  setHeight(editor.getContentHeight());
                }
                updateHeight();
                editor.onDidContentSizeChange(updateHeight);
                editor.onDidFocusEditorText(() => {
                  setIsFocused(true);
                });
                editor.onDidBlurEditorText(() => {
                  setIsFocused(false);
                });
              }}
              onChange={(code) => callback.current(code)}
            />
          )}
        </code>
      </div>
    </pre>
  );
}
const ReactCodeBlockNode_m = memo(ReactCodeBlockNode_);
function ReactCodeBlockNode({ value }: ReactCodeBlockNodeProps): JSX.Element {
  const selectedBlocks = useContext(SelectedBlocksContext);
  const isSelected = selectedBlocks.includes(value.id);
  return <ReactCodeBlockNode_m value={value} isSelected={isSelected} />;
}

const preloadComponents = [
  dynamic(() => import('./prettierImports').then(() => () => null)),
];

let monacoP: Promise<typeof import('monaco-editor')>;
if (typeof window !== 'undefined') {
  monacoP = loader.init();
  Promise.all([monacoP, import('./monacoTypescriptDefinitions')]).then(
    ([monaco, typescriptDefinitions]) => {
      monaco.editor.defineTheme('my-theme', monacoTheme as any);
      const compilerOptions: import('monaco-editor').languages.typescript.CompilerOptions =
        {
          target: monaco.languages.typescript.ScriptTarget.Latest,
          allowNonTsExtensions: true,
          moduleResolution:
            monaco.languages.typescript.ModuleResolutionKind.NodeJs,
          module: monaco.languages.typescript.ModuleKind.CommonJS,
          noEmit: true,
          esModuleInterop: true,
          jsx: monaco.languages.typescript.JsxEmit.React,
          reactNamespace: 'React',
          allowJs: true,
          typeRoots: ['node_modules/@types'],
          experimentalDecorators: true,
        };
      const diagnosticOptions: import('monaco-editor').languages.typescript.DiagnosticsOptions =
        {
          noSemanticValidation: true,
          noSyntaxValidation: true,
        };
      monaco.languages.typescript.typescriptDefaults.setCompilerOptions(
        compilerOptions,
      );
      monaco.languages.typescript.javascriptDefaults.setCompilerOptions(
        compilerOptions,
      );
      monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions(
        diagnosticOptions,
      );
      monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions(
        diagnosticOptions,
      );
      const typeDefinitions = {
        'file:///node_modules/@types/react/index.d.ts':
          typescriptDefinitions.react,
        'file:///node_modules/@types/react/global.d.ts':
          typescriptDefinitions.reactGlobal,
        'file:///node_modules/@types/react-dom/index.d.ts':
          typescriptDefinitions.reactDom,
        'file:///node_modules/@types/scheduler/tracing.d.ts':
          typescriptDefinitions.schedulerTracing,
        'file:///node_modules/@types/prop-types/index.d.ts':
          typescriptDefinitions.propTypes,
        'file:///node_modules/@types/csstype/index.d.ts':
          typescriptDefinitions.cssType,
      };
      Object.entries(typeDefinitions).forEach(([path, def]) => {
        monaco.languages.typescript.typescriptDefaults.addExtraLib(def, path);
        monaco.languages.typescript.javascriptDefaults.addExtraLib(def, path);
      });
      monaco.languages.register({ id: 'vue' });
      const formatLangs = [
        CodeBlockLanguage.Css,
        CodeBlockLanguage.Html,
        CodeBlockLanguage.Js,
        CodeBlockLanguage.Json,
        CodeBlockLanguage.Ts,
      ];
      async function formatCodeBlock(
        code: string,
        language: CodeBlockLanguage | undefined,
      ): Promise<string> {
        const prettierOpts: PrettierOptions = {
          singleQuote: true,
          trailingComma: 'all',
          tabWidth: 2,
        };
        const {
          prettier,
          prettierParserBabel,
          prettierParserHtml,
          prettierParserPostcss,
          prettierParserTs,
        } = await import(/* webpackPreload: true */ './prettierImports');
        let prettierParser: string | undefined;
        let formatted = code;
        if (language === CodeBlockLanguage.Ts) {
          prettierParser = 'typescript';
        } else if (language === CodeBlockLanguage.Js) {
          prettierParser = 'babel';
        } else if (language === CodeBlockLanguage.Css) {
          prettierParser = 'css';
        } else if (language === CodeBlockLanguage.Html) {
          prettierParser = 'html';
        } else if (language === CodeBlockLanguage.Vue) {
          prettierParser = 'vue';
        }
        if (prettierParser) {
          try {
            formatted = prettier.format(code, {
              ...prettierOpts,
              parser: prettierParser,
              plugins: [
                prettierParserBabel,
                prettierParserHtml,
                prettierParserPostcss,
                prettierParserTs,
              ],
            });
          } catch (error) {
            if (error instanceof Error && error.message.includes('resolve')) {
              throw error;
            }
          }
        }
        return formatted.replace(/[\r\n]+$/, '');
      }
      formatLangs.forEach((lang) => {
        monaco.languages.registerDocumentFormattingEditProvider(
          { language: lang, exclusive: true },
          {
            async provideDocumentFormattingEdits(model) {
              return [
                {
                  range: model.getFullModelRange(),
                  text: await formatCodeBlock(
                    model.getValue(),
                    // @ts-expect-error
                    model._isVue ? CodeBlockLanguage.Vue : lang,
                  ),
                },
              ];
            },
          },
        );
        monaco.languages.registerDocumentRangeFormattingEditProvider(
          { language: lang, exclusive: true },
          {
            async provideDocumentRangeFormattingEdits(model, range) {
              return [
                {
                  range: model.getFullModelRange(),
                  text: await formatCodeBlock(
                    model.getValue(),
                    // @ts-expect-error
                    model._isVue ? CodeBlockLanguage.Vue : lang,
                  ),
                },
              ];
            },
          },
        );
      });
    },
  );
}

function ReactParagraphNode_(props: {
  value: ParagraphNode;
  listIndex?: number;
  isFirstListItem?: boolean;
}): JSX.Element {
  const { value } = props;
  const isEmpty =
    value.children.length === 1 &&
    value.children[0].type === InlineNodeType.Text &&
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
        if (inline.type === InlineNodeType.Text && inline.style.link) {
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
                !prevChild ||
                (prevChild.type === InlineNodeType.Text &&
                  !prevChild.style.code);
              const isLast =
                !nextChild ||
                (nextChild.type === InlineNodeType.Text &&
                  !nextChild.style.code);
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
  const alignCls =
    value.style.align === TextAlign.Left
      ? 'block-align-left'
      : value.style.align === TextAlign.Right
      ? 'block-align-right'
      : value.style.align === TextAlign.Center
      ? 'block-align-center'
      : value.style.align === TextAlign.Justify
      ? 'block-align-justify'
      : undefined;
  let style: React.CSSProperties = {
    marginLeft: value.style.indentLevel && `${value.style.indentLevel * 2}em`,
  };
  switch (value.style.type) {
    case ParagraphStyleType.Default: {
      return (
        <p
          className={
            'paragraph-container--with-toplevel-padding' + ' ' + alignCls
          }
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
          className={
            'paragraph-container--with-toplevel-padding' + ' ' + alignCls
          }
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
          className={
            'paragraph-container--with-toplevel-padding' + ' ' + alignCls
          }
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
          className={
            'paragraph-container--with-toplevel-padding' + ' ' + alignCls
          }
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
    case ParagraphStyleType.Heading4: {
      return (
        <h4
          className={
            'paragraph-container--with-toplevel-padding' + ' ' + alignCls
          }
          style={style}
          data-family={EditorFamilyType.Block}
          data-type={BlockNodeType.Paragraph}
          data-empty-paragraph={isEmpty}
          data-id={value.id}
        >
          {children}
        </h4>
      );
    }
    case ParagraphStyleType.BlockQuote: {
      return (
        <blockquote
          className={alignCls}
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
          className={[
            'bullet-list',
            (alignCls || 'block-align-left') + '-list-container',
            'paragraph-container--with-toplevel-padding',
            props.isFirstListItem && 'first-list-item',
          ]
            .filter(Boolean)
            .join(' ')}
          style={omit(style, ['marginLeft'])}
        >
          <div
            className="block-list-item__inner"
            data-family={EditorFamilyType.Block}
            data-type={BlockNodeType.Paragraph}
            data-empty-paragraph={isEmpty}
            data-id={value.id}
          >
            {children}
          </div>
        </li>
      );
    }
    case ParagraphStyleType.NumberedList: {
      return (
        <li
          className={[
            'numbered-list',
            (alignCls || 'block-align-left') + '-list-container',
            'paragraph-container--with-toplevel-padding',
            props.isFirstListItem && 'first-list-item',
          ]
            .filter(Boolean)
            .join(' ')}
          style={
            {
              ...omit(style, ['marginLeft']),
              '--num-width': (props.listIndex! + 1).toString().length + 'ch',
            } as React.CSSProperties
          }
          data-num={props.listIndex! + 1}
        >
          <div
            className="block-list-item__inner"
            data-family={EditorFamilyType.Block}
            data-type={BlockNodeType.Paragraph}
            data-empty-paragraph={isEmpty}
            data-id={value.id}
          >
            {children}
          </div>
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
            'inline-code',
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
}
function ReactEditorValue_({
  value,
  listBlockIdToIdx,
}: ReactEditorValueProps & {
  listBlockIdToIdx: Record<string, number>;
}): JSX.Element {
  let children: JSX.Element[] = [];
  const grouped = groupArr(
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
  );
  grouped.forEach((group, i) => {
    const { groupInfo } = group;
    if (groupInfo !== null) {
      const { listType, listId, indent } = groupInfo;
      const items = group.items as (ParagraphNode & {
        style: BulletListParagraphStyle | NumberedListParagraphStyle;
      })[];
      const listNodes = items.map((block, j) => {
        const isFirstListItem =
          j === 0 && !(i > 0 && grouped[i - 1].groupInfo?.listId === listId);
        if (block.style.type === ParagraphStyleType.NumberedList) {
          return (
            <ReactParagraphNode
              value={
                block as ParagraphNode & {
                  style: NumberedListParagraphStyle;
                }
              }
              listIndex={listBlockIdToIdx[block.id]}
              isFirstListItem={isFirstListItem}
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
            isFirstListItem={isFirstListItem}
            key={block.id}
          />
        );
      });
      const isLastList =
        i === grouped.length - 1 || grouped[i + 1].groupInfo?.listId !== listId;
      if (listType === ParagraphStyleType.NumberedList) {
        children.push(
          <ol
            key={items[0].id}
            start={listBlockIdToIdx[items[0].id] + 1}
            data-indent={indent}
            className={isLastList ? 'last-list' : undefined}
          >
            {listNodes}
          </ol>,
        );
      } else {
        children.push(
          <ul
            key={items[0].id}
            data-indent={indent}
            className={isLastList ? 'last-list' : undefined}
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
          children.push(<ReactTableNode value={block} key={block.id} />);
          break;
        }
        case BlockNodeType.Code: {
          children.push(<ReactCodeBlockNode value={block} key={block.id} />);
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
    <EditorIdContext.Provider value={value.id}>
      <div
        className="editor-container"
        data-family={EditorFamilyType.Editor}
        data-id={value.id}
      >
        {children}
      </div>
    </EditorIdContext.Provider>
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
  Block = 'Block',
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
        if (para.type !== BlockNodeType.Paragraph) {
          throw new Error();
        }
        let offset = 0;
        for (let i = 0; i < para.children.length; i++) {
          const node = para.children[i];
          if (node.id === textId) {
            offset += nearestOffset;
            break;
          }
          offset += node.type !== InlineNodeType.Text ? 1 : node.text.length;
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
  const family = nearestDocNode.getAttribute('data-family');
  const blockId = nearestDocNode.getAttribute('data-id')!;
  if (family === EditorFamilyType.Block) {
    return {
      type: FindPointResultType.Block,
      editorId,
      point: {
        type: BlockSelectionPointType.OtherBlock,
        blockId,
      },
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
      parentBlock: TableNode;
    } | null,
  ) => { data: T; newValue?: EditorValue; stop: boolean; stopCur?: boolean },
  initialData: T,
  willMap: boolean,
  onBlock?: (block: BlockNode, data: T, parentEditor: EditorValue) => void,
): { didStop: boolean; retValue: T; mappedEditor: EditorValue } {
  let didStop = false;
  let retValue: T = initialData;
  function walk(
    value: WritableDraft<EditorValue> | EditorValue,
    data: T,
  ): void {
    for (let bI = 0; bI < value.blocks.length && !didStop; bI++) {
      const block = value.blocks[bI];
      onBlock?.(block, data, value);
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

function isDomPositionsBackwardsCmp(
  anchorNode: Node,
  anchorOffset: number,
  focusNode: Node,
  focusOffset: number,
): boolean {
  let position = anchorNode.compareDocumentPosition(focusNode!);
  return (
    (!position && anchorOffset > focusOffset) ||
    position === Node.DOCUMENT_POSITION_PRECEDING
  );
}

function isSelectionBackwards(selection: globalThis.Selection): boolean {
  return isDomPositionsBackwardsCmp(
    selection.anchorNode!,
    selection.anchorOffset,
    selection.focusNode!,
    selection.focusOffset,
  );
}

function getEncompassingRange(
  selection: globalThis.Selection,
): globalThis.Range {
  let range = selection.getRangeAt(0);
  if (
    isFirefox &&
    range.endContainer instanceof HTMLElement &&
    range.endContainer.matches('.block-table__tr')
  ) {
    range.setEnd(range.startContainer, range.startOffset);
  }
  for (let i = 1; i < selection.rangeCount; i++) {
    const selRange = selection.getRangeAt(i);
    if (
      isDomPositionsBackwardsCmp(
        range.startContainer,
        range.startOffset,
        selRange.startContainer,
        selRange.startOffset,
      )
    ) {
      range.setStart(selRange.startContainer, selRange.startOffset);
    }
    if (
      isDomPositionsBackwardsCmp(
        selRange.endContainer,
        selRange.endOffset,
        range.endContainer,
        range.endOffset,
      )
    ) {
      range.setEnd(
        selRange.endContainer,
        isFirefox &&
          selRange.endContainer instanceof HTMLElement &&
          selRange.endContainer.matches('.block-table__tr')
          ? selRange.startOffset
          : selRange.endOffset,
      );
    }
  }
  return range;
}

function getTableCellPoint(table: TableNode, editorId: string): TableCellPoint {
  const row = table.rows.find((row) =>
    row.cells.some((cell) => cell.value.id === editorId),
  )!;
  const rowIndex = table.rows.indexOf(row);
  const columnIndex = row.cells.findIndex((cell) => cell.value.id === editorId);
  return { rowIndex, columnIndex };
}

function findSelection(
  value: EditorValue,
  range: Range | StaticRange,
  isBackwards: boolean,
): Selection {
  const startPoint = findPoint(value, range.startContainer, range.startOffset);
  const endPoint = findPoint(value, range.endContainer, range.endOffset);
  if (startPoint.editorId === endPoint.editorId) {
    return fixSelection(value, {
      type: SelectionType.Block,
      editorId: startPoint.editorId,
      start: isBackwards ? endPoint.point : startPoint.point,
      end: isBackwards ? startPoint.point : endPoint.point,
    });
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
  Forwards = 'Forwards',
  Collapsed = 'Collapsed',
  Backwards = 'Backwards',
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
    return Direction.Backwards;
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
  if (
    children.some(
      (child) => child.type === InlineNodeType.Text && child.text === '',
    )
  ) {
    children = children.filter(
      (child) => child.type !== InlineNodeType.Text || child.text !== '',
    );
  }
  let newChildren = [children[0]];
  for (let i = 1; i < children.length; i++) {
    const prev = newChildren[newChildren.length - 1];
    const cur = children[i];
    if (prev.type !== InlineNodeType.Text || cur.type !== InlineNodeType.Text) {
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
  Separate = 'Separate',
  SameLevel = 'SameLevel',
  Contained = 'Contained',
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
    len += child.type !== InlineNodeType.Text ? 1 : child.text.length;
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
            if (block.type !== BlockNodeType.Paragraph) {
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
    block: Extract<
      InlineNode,
      { type: Exclude<InlineNodeType, InlineNodeType.Text> }
    >,
  ) => Extract<
    InlineNode,
    { type: Exclude<InlineNodeType, InlineNodeType.Text> }
  >,
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
        if (child.type !== InlineNodeType.Text) {
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
            if (block.type !== BlockNodeType.Paragraph) {
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
              if (block.type !== BlockNodeType.Paragraph) {
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
                if (block.type !== BlockNodeType.Paragraph) {
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
          paraA.children[paraA.children.length - 1].type ===
            InlineNodeType.Text &&
          paraB.children.length > 0 &&
          paraB.children[0].type === InlineNodeType.Text &&
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
            if (block.type !== BlockNodeType.Paragraph) {
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
    (len, node) =>
      len + (node.type !== InlineNodeType.Text ? 1 : node.text.length),
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
          if (firstBlock.type !== BlockNodeType.Paragraph) {
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
            if (lastBlock.type !== BlockNodeType.Paragraph) {
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
            if (lastBlock.type !== BlockNodeType.Paragraph) {
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
                if (lastBlock.type !== BlockNodeType.Paragraph) {
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
          if (inlineNode.type !== InlineNodeType.Text) {
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
          end +=
            inlineNode.type !== InlineNodeType.Text
              ? 1
              : inlineNode.text.length;
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
        if (endBlock.type !== BlockNodeType.Paragraph) {
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
      if (block.type !== BlockNodeType.Paragraph) {
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
  Plain = 'Plain',
  Rich = 'Rich',
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

const SelectedBlocksContext = createContext<string[]>([]);

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
const isFirefox =
  typeof window !== 'undefined' &&
  navigator.userAgent.toLowerCase().indexOf('firefox') > -1;

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
const DELETE = 46;
const SPACE = 32;
const ONE = 49;
const TWO = 50;
const THREE = 51;
const FOUR = 52;
const EIGHT = 56;
const NINE = 57;
const A = 65;
const B = 66;
const D = 68;
const E = 69;
const H = 72;
const I = 73;
const J = 74;
const K = 75;
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
const isAlignJustify = allPass([hasControlKey, hasKeyCode(J)]);
const isIndent = allPass([hasControlKey, not(hasShiftKey), hasKeyCode(M)]);
const isOutdent = allPass([hasControlKey, hasShiftKey, hasKeyCode(M)]);
const isAnyDeleteBackward = anyPass([
  allPass([
    (event: CompatibleKeyboardEvent) =>
      !isApple || !event.ctrlKey || event.altKey,
    hasKeyCode(BACKSPACE),
  ]),
  allPass([hasControlKey, not(hasShiftKey), hasKeyCode(H)]),
]);
const isAnyDeleteForward = anyPass([
  allPass([
    (event: CompatibleKeyboardEvent) =>
      !isApple || !event.ctrlKey || event.altKey,
    hasKeyCode(DELETE),
  ]),
  allPass([hasControlKey, not(hasShiftKey), hasKeyCode(D)]),
  allPass([hasControlKey, not(hasShiftKey), hasKeyCode(K)]),
]);
const isSpace = allPass([hasNoModifiers, hasKeyCode(SPACE)]);
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
const isHeading4 = allPass([hasCommandOptionKey, hasKeyCode(FOUR)]);
const isBlockQuote = allPass([
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
const isSelectAll = allPass([
  hasCommandModifier,
  not(hasShiftKey),
  hasKeyCode(A),
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
      if (block.type === BlockNodeType.Table) {
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
    if (block.type !== BlockNodeType.Paragraph) {
      return false;
    }
    return block.children.some(
      (child) => child.type === InlineNodeType.Text && condition(child),
    );
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
    const point = (selection as BlockSelection).start;
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
    textStyle: getSelectionTextStyle(edit.value, selection),
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
    const point = (selection as BlockSelection).start;
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
  const fragment = extractSelection(value, selection);
  return (
    fragment.blocks.some((block) => block.type === BlockNodeType.Paragraph) &&
    !anyBlockMatches(
      fragment,
      (block) =>
        block.type === BlockNodeType.Paragraph && !condition(block.style),
    )
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
    (block) =>
      block.type === BlockNodeType.Paragraph && !condition(block.style),
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

  const range = getEncompassingRange(selection).cloneRange();
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
    scrollerPaddingTop =
      (document.querySelector('.toolbar') as HTMLElement | null)
        ?.offsetHeight || 0;
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
  Input = 'Input',
  InlineFormat = 'InlineFormat',
  BlockFormat = 'BlockFormat',
  ClearFormat = 'ClearFormat',
  ReplaceBlock = 'ReplaceBlock',
  Undo = 'Undo',
  Redo = 'Redo',
  DeleteBackwardKey = 'DeleteBackwardKey',
  DeleteForwardKey = 'DeleteForwardKey',
  Selection = 'Selection',
  SpaceKey = 'Space',
  SelectAll = 'SelectAll',
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
      type: CommandType.Redo | CommandType.Undo | CommandType.SelectAll;
      origin?: string;
    }
  | {
      type:
        | CommandType.ClearFormat
        | CommandType.DeleteBackwardKey
        | CommandType.DeleteForwardKey
        | CommandType.SpaceKey;
      selection: Selection;
      origin?: string;
    }
  | {
      type: CommandType.Selection;
      selection: Selection | null;
      doNotUpdateSelection?: boolean;
      mergeLast?: boolean;
      doNotScroll?: boolean;
      origin?: string;
    };
const cmds = {
  bold: {
    isKey: isBold,
    icon: {
      isActive: (c) => !!c.textStyle.bold,
      Icon: BoldIcon,
    },
    getCmds: (selection) =>
      !selection
        ? []
        : [
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
    getCmds: (selection) =>
      !selection
        ? []
        : [
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
    getCmds: (selection) =>
      !selection
        ? []
        : [
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
    getCmds: (selection) =>
      !selection
        ? []
        : [
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
    getCmds: (selection) =>
      !selection
        ? []
        : [
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
    getCmds: (selection) =>
      !selection
        ? []
        : [
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
    getCmds: (selection) =>
      !selection
        ? []
        : [
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
  'align left': {
    isKey: isAlignLeft,
    icon: {
      isActive: (c) =>
        isParagraphStyleActive(
          c.value,
          c.selection!,
          (style) => style.align === TextAlign.Left,
        ),
      Icon: AlignLeftIcon,
    },
    getCmds: (selection) =>
      !selection
        ? []
        : [
            {
              type: CommandType.BlockFormat,
              selection,
              condition: (style) =>
                !style.align || style.align === TextAlign.Left,
              transform: (style, active) => ({
                ...style,
                align: active ? undefined : TextAlign.Left,
              }),
            },
          ],
  },
  'align center': {
    isKey: isAlignCenter,
    icon: {
      isActive: (c) =>
        isParagraphStyleActive(
          c.value,
          c.selection!,
          (style) => style.align === TextAlign.Center,
        ),
      Icon: AlignCenterIcon,
    },
    getCmds: (selection) =>
      !selection
        ? []
        : [
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
    icon: {
      isActive: (c) =>
        isParagraphStyleActive(
          c.value,
          c.selection!,
          (style) => style.align === TextAlign.Right,
        ),
      Icon: AlignRightIcon,
    },
    getCmds: (selection) =>
      !selection
        ? []
        : [
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
  'align justify': {
    isKey: isAlignJustify,
    icon: {
      isActive: (c) =>
        isParagraphStyleActive(
          c.value,
          c.selection!,
          (style) => style.align === TextAlign.Justify,
        ),
      Icon: AlignJustifyIcon,
    },
    getCmds: (selection) =>
      !selection
        ? []
        : [
            {
              type: CommandType.BlockFormat,
              selection,
              condition: (style) => style.align === TextAlign.Justify,
              transform: (style, active) => ({
                ...style,
                align: active ? undefined : TextAlign.Justify,
              }),
            },
          ],
  },
  'code block': {
    isKey: isHeading1,
    icon: {
      isActive: (c) => {
        const frag = extractSelection(c.value, c.selection!);
        return frag.blocks.every((block) => block.type === BlockNodeType.Code);
      },
      Icon: CodeBlockIcon,
    },
    getCmds: (selection, makeId) => {
      if (!selection || !isCollapsed(selection)) {
        return [];
      }
      const codeBlockId = makeId();
      const insertFrag = makeEditorValue(
        [makeCodeBlock('', CodeBlockLanguage.PlainText, codeBlockId)],
        makeId(),
      );
      const blockPoint: BlockPoint = {
        type: BlockSelectionPointType.OtherBlock,
        blockId: codeBlockId,
      };
      return [
        {
          type: CommandType.Input,
          selection,
          inputType: 'insertText',
          data: {
            type: DataTransferType.Rich,
            value: insertFrag,
          },
        },
        {
          type: CommandType.Selection,
          selection: {
            type: SelectionType.Block,
            editorId: selection.editorId,
            start: blockPoint,
            end: blockPoint,
          },
          mergeLast: true,
        },
      ];
    },
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
    getCmds: (selection) =>
      !selection
        ? []
        : [
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
    getCmds: (selection) =>
      !selection
        ? []
        : [
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
      Icon: Heading3Icon,
    },
    getCmds: (selection) =>
      !selection
        ? []
        : [
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
  'heading 4': {
    isKey: isHeading4,
    icon: {
      isActive: (c) =>
        isParagraphStyleActive(
          c.value,
          c.selection!,
          (style) => style.type === ParagraphStyleType.Heading4,
        ),
      Icon: Heading4Icon,
    },
    getCmds: (selection) =>
      !selection
        ? []
        : [
            {
              type: CommandType.BlockFormat,
              selection,
              condition: (style) => style.type === ParagraphStyleType.Heading4,
              transform: (style, active) => ({
                ...style,
                type: active
                  ? ParagraphStyleType.Default
                  : ParagraphStyleType.Heading4,
              }),
            },
          ],
  },
  'block quote': {
    isKey: isBlockQuote,
    icon: {
      isActive: (c) =>
        isParagraphStyleActive(
          c.value,
          c.selection!,
          (style) => style.type === ParagraphStyleType.BlockQuote,
        ),
      Icon: BlockQuoteIcon,
    },
    getCmds: (selection) =>
      !selection
        ? []
        : [
            {
              type: CommandType.BlockFormat,
              selection,
              condition: (style) =>
                style.type === ParagraphStyleType.BlockQuote,
              transform: (style, active) => ({
                ...style,
                type: active
                  ? ParagraphStyleType.Default
                  : ParagraphStyleType.BlockQuote,
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
      if (!selection) {
        return [];
      }
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
      if (!selection) {
        return [];
      }
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
  outdent: {
    isKey: isOutdent,
    icon: {
      isActive: () => false,
      Icon: DedentIcon,
    },
    getCmds: (selection) =>
      !selection
        ? []
        : [
            {
              type: CommandType.BlockFormat,
              selection,
              condition: () => false,
              transform: (style) => ({
                ...style,
                indentLevel: style.indentLevel
                  ? style.indentLevel - 1
                  : undefined,
              }),
            },
          ],
  },
  indent: {
    isKey: isIndent,
    icon: {
      isActive: () => false,
      Icon: IndentIcon,
    },
    getCmds: (selection) =>
      !selection
        ? []
        : [
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
  'clear format': {
    isKey: isClearFormatting,
    getCmds: (selection) =>
      !selection
        ? []
        : [
            {
              type: CommandType.ClearFormat,
              selection,
            },
          ],
  },
  undo: {
    isKey: isUndo,
    icon: {
      isActive: () => false,
      Icon: UndoIcon,
    },
    getCmds: () => [
      {
        type: CommandType.Undo,
      },
    ],
  },
  redo: {
    isKey: isRedo,
    icon: {
      isActive: () => false,
      Icon: RedoIcon,
    },
    getCmds: () => [
      {
        type: CommandType.Redo,
      },
    ],
  },
  'any delete backward': {
    isKey: isAnyDeleteBackward,
    getCmds: (selection) =>
      !selection
        ? []
        : [
            {
              type: CommandType.DeleteBackwardKey,
              selection,
            },
          ],
  },
  'any delete forward': {
    isKey: isAnyDeleteForward,
    getCmds: (selection) =>
      !selection
        ? []
        : [
            {
              type: CommandType.DeleteForwardKey,
              selection,
            },
          ],
  },
  space: {
    isKey: isSpace,
    getCmds: (selection) =>
      !selection
        ? []
        : [
            {
              type: CommandType.SpaceKey,
              selection,
            },
          ],
  },
  'select all': {
    isKey: isSelectAll,
    getCmds: (selection) =>
      !selection ? [] : [{ type: CommandType.SelectAll, selection }],
  },
} satisfies {
  [name: string]: {
    isKey: (event: KeyboardEvent) => boolean;
    icon?: {
      isActive: (editorCtrl: EditorController) => boolean;
      Icon: typeof ToolbarIcon;
    };
    getCmds: (selection: Selection | null, makeId: () => string) => Command[];
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
    /* fontWeight: 'bold', */ // unnecessary bold on heading
  },
  h2: {
    display: 'block',
    /* fontWeight: 'bold', */ // unnecessary bold on heading
  },
  h3: {
    display: 'block',
    /* fontWeight: 'bold', */ // unnecessary bold on heading
  },
  h4: {
    display: 'block',
    /* fontWeight: 'bold', */ // unnecessary bold on heading
  },
  h5: {
    display: 'block',
    /* fontWeight: 'bold', */ // unnecessary bold on heading
  },
  h6: {
    display: 'block',
    /* fontWeight: 'bold', */ // unnecessary bold on heading
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
      return 'about:blank';
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

  let href: string | undefined;
  const parentAnchor = parents.find(
    (el): el is HTMLAnchorElement => el.tagName.toLowerCase() === 'a',
  );
  ifstmt: if (parentAnchor && parentAnchor.href) {
    const sanitized = sanitizeUrl(parentAnchor.href);
    const url = new URL(sanitized);
    if (url.hash) {
      if (
        parents.some((el) =>
          ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(
            el.tagName.toLowerCase(),
          ),
        )
      ) {
        break ifstmt;
      }
    }
    href = sanitized;
  }

  return {
    bold:
      Number(fontWeight) >= 600 ||
      fontWeight === 'bold' ||
      fontWeight === 'bolder'
        ? true
        : undefined,
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
    link: href ? { href } : undefined,
  };
}

function normalizeText(text: string): string {
  return text.replace(
    /[\u00A0\u1680\u180E\u2000-\u200B\u202F\u205F\u3000\uFEFF]/,
    ' ',
  );
}

const QueueCommandContext = createContext<(cmd: Command) => void>(() => {});
const EditorIdContext = createContext<string>('');

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
          node.parentNode!.nodeName.toLowerCase() === 'pre' ||
          node.nodeName.toLowerCase() === 'button' ||
          (isBlock(node.parentNode!) &&
            (Array.from((node.parentNode as HTMLElement).classList).some(
              (cls) => cls.includes('code'),
            ) ||
              (node.parentNode as HTMLElement).style.fontFamily
                .toLowerCase()
                .includes('monospace')))
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        if (
          node instanceof HTMLElement &&
          (node.style.visibility == 'hidden' || node.style.display === 'none')
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
        ['block', 'flex', 'grid', 'list-item', 'table', 'table-row'] as (
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
          } else if (n === 2) {
            return makeHeading2Paragraph([], makeId(), paraStyleBase);
          } else if (n === 3) {
            return makeHeading3Paragraph([], makeId(), paraStyleBase);
          } else if (n === 4 || n === 5 || n === 6) {
            return makeHeading4Paragraph([], makeId(), paraStyleBase);
          }
        }
        if (blockEl.tagName.toLowerCase().startsWith('blockquote')) {
          return makeBlockQuoteParagraph([], makeId(), paraStyleBase);
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
      const lastListIndex =
        ulIdx !== -1 || olIdx !== -1
          ? blockParents.length -
            1 -
            blockParents
              .slice()
              .reverse()
              .findIndex(
                (el) =>
                  el.tagName.toLowerCase() === 'ul' ||
                  el.tagName.toLowerCase() === 'ol',
              )
          : -1;
      if (olIdx !== -1) {
        if (ulIdx === -1 || ulIdx > olIdx) {
          return makeNumberedListParagraph(
            [],
            makeIdCached(blockParents[lastListIndex]),
            makeId(),
            paraStyleBase,
          );
        }
      }
      return makeBulletListParagraph(
        [],
        ulIdx !== -1 ? makeIdCached(blockParents[lastListIndex]) : makeId(),
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
    if (
      isBlock(node) ||
      node.nodeName.toLowerCase() === 'table' ||
      (node.nodeName.toLowerCase() === 'img' &&
        (node as HTMLElement).hasAttribute('src'))
    ) {
      const blockEl = node as HTMLElement;
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
      if (
        blockEl.tagName.toLowerCase() === 'pre' ||
        Array.from(blockEl.classList).some((cls) => cls.includes('code')) ||
        blockEl.style.fontFamily.toLowerCase().includes('monospace')
      ) {
        const getLangFromEl = (
          elm: HTMLElement,
        ): CodeBlockLanguage | undefined => {
          const cns = Array.from(elm.classList);
          if (cns.some((cls) => /\bhtml\b/.test(cls))) {
            return CodeBlockLanguage.Html;
          } else if (
            cns.some((cls) => /\bjavascript/.test(cls)) ||
            cns.some((cls) => /\bjs/.test(cls))
          ) {
            return CodeBlockLanguage.Js;
          } else if (
            cns.some((cls) => /\btypescript/.test(cls)) ||
            cns.some((cls) => /\bts/.test(cls))
          ) {
            return CodeBlockLanguage.Ts;
          } else if (cns.some((cls) => /\bvue/.test(cls))) {
            return CodeBlockLanguage.Vue;
          } else if (
            cns.some((cls) => /\bhljs/.test(cls))
              ? cns.some((cls) => /\blanguage-css/.test(cls))
              : cns.some((cls) => /\bcss/.test(cls))
          ) {
            return CodeBlockLanguage.Css;
          } else if (cns.some((cls) => cls.includes('json'))) {
            return CodeBlockLanguage.Json;
          }
        };
        let lang = getLangFromEl(blockEl);
        if (!lang) {
          const codeEls = blockEl.querySelectorAll('pre,code');
          for (let i = 0; i < codeEls.length && !lang; i++) {
            lang = getLangFromEl(codeEls[i] as HTMLElement);
          }
        }
        if (!lang && blockEl.parentElement) {
          lang = getLangFromEl(blockEl.parentElement);
        }
        if (!lang) {
          const keywords = [
            'html',
            'javascript',
            '-js',
            'typescript',
            'ts',
            'vue',
            'css',
            'json',
          ];
          const langChild = blockEl.querySelector(
            keywords.map((kwd) => `[class*="${kwd}"]`).join(','),
          );
          if (langChild) {
            lang = getLangFromEl(langChild as HTMLElement);
          }
        }
        let text = '';
        const walker = document.createTreeWalker(
          blockEl,
          NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
          {
            acceptNode(n) {
              if (
                n.nodeName.toLowerCase() === 'button' ||
                (n.nodeType === Node.ELEMENT_NODE &&
                  Array.from((n as HTMLElement).classList).some((cn) =>
                    cn.includes('gutter'),
                  ))
              ) {
                return NodeFilter.FILTER_REJECT;
              }
              if (n.nodeName.toLowerCase() === 'br') {
                text += '\n';
                return NodeFilter.FILTER_REJECT;
              }
              if (
                n.nodeType === Node.ELEMENT_NODE &&
                Array.from((n as HTMLElement).classList).some(
                  (cls) => cls === 'gatsby-highlight-code-line',
                )
              ) {
                text += normalizeText(n.textContent || '');
                text += '\n';
                return NodeFilter.FILTER_REJECT;
              }
              if (isBlock(n)) {
                const b = n as HTMLElement;
                if (text && (!b.innerText || b.innerText !== '\n')) {
                  text += '\n';
                }
              }
              return NodeFilter.FILTER_ACCEPT;
            },
          },
        );
        let n: Node | null = null;
        while ((n = walker.nextNode())) {
          if (n.nodeType === Node.TEXT_NODE) {
            text += normalizeText(n.textContent || '');
          }
        }
        const code = text
          .split(/\r?\n/)
          .map((line) => line.trimEnd())
          .join('\n')
          .replace(/^(\r|\n)+|(\r|\n)+$/g, '');
        blocks.push(
          makeCodeBlock(code, lang || CodeBlockLanguage.PlainText, makeId()),
        );
        prevBlockParent = undefined;
        continue;
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
      const text = normalizeText(node.textContent);
      const style = getTextStylesFromElement(
        node.parentElement!,
        parentElements,
      );
      const lastBlock =
        blocks.length > 0 ? blocks[blocks.length - 1] : undefined;
      if (
        parentBlock === prevBlockParent &&
        lastBlock &&
        lastBlock.type === BlockNodeType.Paragraph
      ) {
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
    if (block.type === BlockNodeType.Paragraph) {
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
  placeholder,
  initialValue,
  makeId,
}: {
  placeholder: string;
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
  let newDomSelectionRef = useRef<{
    sel: Selection | null;
    doNotScroll?: boolean;
  } | null>(null);
  const [_renderToggle, setRenderToggle] = useState(false);

  const updateSelection = (newSelection: Selection): void => {
    let native = window.getSelection()!;

    if (
      !document.activeElement ||
      !(
        document.activeElement &&
        editorRef.current!.contains(document.activeElement) &&
        native.anchorNode &&
        closest(native.anchorNode, '.monaco-editor')
      )
    ) {
      editorRef.current!.focus();
      native = window.getSelection()!;
    }

    const range = makeDOMRange(
      newSelection,
      editorCtrl.current.value,
      editorRef.current!,
    );

    isUpdatingSelection.current++;
    if (native.rangeCount > 1) {
      native.removeAllRanges();
    }
    if (
      getDirection(editorCtrl.current.value, newSelection) ===
      Direction.Backwards
    ) {
      if (
        !(
          range.endContainer === native.anchorNode &&
          range.endOffset === native.anchorOffset &&
          range.startContainer === native.focusNode &&
          range.startOffset === native.focusOffset
        )
      ) {
        console.log(
          'manually setting selection',
          range.endContainer,
          range.startContainer,
          native.anchorNode,
          native.focusNode,
        );
        native.setBaseAndExtent(
          range.endContainer,
          range.endOffset,
          range.startContainer,
          range.startOffset,
        );
        setTimeout(() => {
          isUpdatingSelection.current--;
        });
      } else {
        isUpdatingSelection.current--;
      }
    } else {
      if (
        !(
          range.startContainer === native.anchorNode &&
          range.startOffset === native.anchorOffset &&
          range.endContainer === native.focusNode &&
          range.endOffset === native.focusOffset
        )
      ) {
        console.log(
          'manually setting selection',
          range.startContainer,
          range.endContainer,
          native.anchorNode,
          native.focusNode,
        );
        native.setBaseAndExtent(
          range.startContainer,
          range.startOffset,
          range.endContainer,
          range.endOffset,
        );
        setTimeout(() => {
          isUpdatingSelection.current--;
        });
      } else {
        isUpdatingSelection.current--;
      }
    }
  };

  const pushState = useCallback(
    (
      curEditorCtrl: EditorController,
      newValue: EditorValue,
      newSelection: Selection | null,
      newTextStyle: TextStyle,
      action: PushStateAction | string,
      merge = false,
    ): EditorController => {
      let undos = curEditorCtrl.undos;
      if (
        !merge &&
        action !== PushStateAction.Selection &&
        (action === PushStateAction.Unique ||
          curEditorCtrl.lastAction !== action)
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
        lastAction: merge ? curEditorCtrl.lastAction : action,
        makeId,
      };
    },
    [makeId],
  );

  const copySelection = useCallback(
    (value: EditorValue, selection: Selection): void => {
      const curValue = extractSelection(value, selection);
      useIsomorphicLayoutEffect = useEffect;
      const htmlText = renderToStaticMarkup(
        <>
          <span data-matita={JSON.stringify(curValue)} />
          <NumberedListIndicesContext.Provider
            value={getListBlockIdToIdx(value)}
          >
            <ReactEditorValue value={curValue} />
          </NumberedListIndicesContext.Provider>
        </>,
      );
      useIsomorphicLayoutEffect = useLayoutEffect;
      navigator.clipboard
        .write([
          new ClipboardItem({
            'text/plain': new Blob([extractText(curValue)], {
              type: 'text/plain',
            }),
            'text/html': new Blob([htmlText], { type: 'text/html' }),
          }),
        ])
        .catch((error) => {
          console.error('error writing to clipboard', error);
        });
    },
    [],
  );

  const flushInputQueue = useCallback((): void => {
    inputQueueRequestRef.current = null;
    let mapSelectionFns: ((
      selection: Selection,
      isCursor: boolean,
    ) => Selection)[] = [];
    const queue = inputQueueRef.current;
    inputQueueRef.current = [];
    let newEditorCtrl = editorCtrl.current;
    console.log('flushing input queue', ...queue);
    let dropValue: EditorValue | null = null;
    let ignoreNext: boolean = false;
    let setNewSelection = true; // TODO fix.
    let doNotScroll: boolean | undefined;
    function mapSel(sel: Selection): Selection {
      return mapSelectionFns.reduce(
        (selection, mapSelection) => mapSelection(selection, true),
        sel,
      );
    }
    function processCommand(command: Command, i: number | null): void {
      if (ignoreNext) {
        ignoreNext = false;
        return;
      }
      if ('selection' in command && !command.selection) {
        if (command.type !== CommandType.Selection) {
          throw new Error('expected selection');
        }
        if (i === queue.length - 1 && command.doNotUpdateSelection) {
          setNewSelection = false;
        }
        if (newEditorCtrl.selection !== null) {
          newEditorCtrl = pushState(
            newEditorCtrl,
            newEditorCtrl.value,
            null,
            {},
            PushStateAction.Selection,
            command.mergeLast,
          );
        }
        return;
      }
      if (command.type === CommandType.Input) {
        const inputSelection = mapSel(command.selection);
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
              getSelectionTextStyle(edit.value, newSelection),
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
          case 'x_updateCodeBlock_Code':
          case 'x_updateCodeBlock_Lang': {
            let action: PushStateAction | string;
            if (
              inputType === 'insertReplacementText' ||
              inputType === 'insertFromYank' ||
              inputType === 'insertFromPaste' ||
              inputType === 'insertFromDrop' ||
              (inputType === 'insertText' &&
                data?.type === DataTransferType.Plain &&
                data.text.includes('\n')) ||
              inputType === 'x_updateCodeBlock_Lang'
            ) {
              action = PushStateAction.Unique;
            } else if (inputType === 'x_updateCodeBlock_Code') {
              if (i === queue.length - 1) {
                setNewSelection = false;
              }
              action = `x_updateCodeBlock_Code${
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
            newEditorCtrl = pushState(
              newEditorCtrl,
              newValue,
              newSelection,
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
            processCommand({ type: CommandType.Undo }, null);
            break;
          }
          case 'historyRedo': {
            processCommand({ type: CommandType.Redo }, null);
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
        const inputSelection = mapSel(command.selection);
        const edit = toggleInlineStyle(
          newEditorCtrl,
          inputSelection,
          command.condition,
          command.transform,
        );
        let newValue = edit.value;
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
        const inputSelection = mapSel(command.selection);
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
        const inputSelection = mapSel(command.selection);
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
      } else if (
        command.type === CommandType.DeleteBackwardKey ||
        command.type === CommandType.DeleteForwardKey
      ) {
        const inputSelection = mapSel(command.selection);
        if (
          inputSelection.type === SelectionType.Block &&
          inputSelection.start.blockId === inputSelection.end.blockId &&
          inputSelection.start.type === BlockSelectionPointType.OtherBlock
        ) {
          processCommand(
            {
              type: CommandType.Input,
              inputType:
                command.type === CommandType.DeleteBackwardKey
                  ? 'deleteContentBackward'
                  : 'deleteContentForward',
              selection: inputSelection,
            },
            null,
          );
          if (i !== null && i < queue.length - 1) {
            const next = queue[i + 1];
            if (
              next.type === CommandType.Input &&
              (command.type === CommandType.DeleteBackwardKey
                ? next.inputType === 'deleteContentBackward' ||
                  next.inputType === 'deleteWordBackward' ||
                  next.inputType === 'deleteSoftLineBackward' ||
                  next.inputType === 'deleteHardLineBackward'
                : command.type === CommandType.DeleteForwardKey &&
                  (next.inputType === 'deleteContentForward' ||
                    next.inputType === 'deleteWordForward' ||
                    next.inputType === 'deleteSoftLineForward' ||
                    next.inputType === 'deleteHardLineForward'))
            ) {
              ignoreNext = true;
            }
          }
        }
        if (
          command.type === CommandType.DeleteForwardKey ||
          !isCollapsed(inputSelection)
        ) {
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
          newEditorCtrl.value,
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
              style.type === ParagraphStyleType.BlockQuote ||
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
                      if (style.type === ParagraphStyleType.BlockQuote) {
                        return makeDefaultParagraph(
                          para.children,
                          para.id,
                          omit(para.style, ['type']),
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
                                  | ParagraphStyleType.BlockQuote;
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
                                | ParagraphStyleType.BlockQuote;
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
      } else if (command.type === CommandType.SpaceKey) {
        const inputSelection = mapSel(command.selection);
        if (!isCollapsed(inputSelection)) {
          return;
        }
        const point = (inputSelection as BlockSelection).start;
        if (
          point.type !== BlockSelectionPointType.Paragraph ||
          (point.offset !== 1 && point.offset !== 2)
        ) {
          return;
        }
        const res = walkEditorValues<boolean | undefined>(
          newEditorCtrl.value,
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
              style.type === ParagraphStyleType.Default &&
              !style.indentLevel &&
              para.children.length === 1 &&
              ['*', '1.'].includes(para.children[0].text)
            ) {
              return {
                stop: true,
                data: true,
                newValue: makeEditorValue(
                  subValue.blocks.map((block) => {
                    if (block.id === point.blockId) {
                      return makeParagraph(
                        [makeText('', newEditorCtrl.textStyle, makeId())],
                        {
                          ...(para.style as DefaultParagraphStyle),
                          type:
                            para.children[0].text === '*'
                              ? ParagraphStyleType.BulletList
                              : ParagraphStyleType.NumberedList,
                          listId: makeId(),
                        },
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
          const newPoint: ParagraphPoint = {
            type: BlockSelectionPointType.Paragraph,
            blockId: point.blockId,
            offset: 0,
          };
          const newSel: Selection = {
            type: SelectionType.Block,
            editorId: inputSelection.editorId,
            start: newPoint,
            end: newPoint,
          };
          processCommand(
            {
              type: CommandType.Input,
              inputType: 'insertText',
              selection: command.selection,
              data: {
                type: DataTransferType.Plain,
                text: ' ',
              },
            },
            null,
          );
          newEditorCtrl = pushState(
            newEditorCtrl,
            res.mappedEditor,
            newSel,
            newEditorCtrl.textStyle,
            PushStateAction.Unique,
          );
          if (i !== null && i < queue.length - 1) {
            const next = queue[i + 1];
            if (
              next.type === CommandType.Input &&
              next.inputType === 'insertText'
            ) {
              ignoreNext = true;
            }
          }
        }
      } else if (command.type === CommandType.Selection) {
        const inputSelection = mapSel(command.selection!);
        if (i === queue.length - 1) {
          if (command.doNotUpdateSelection) {
            setNewSelection = false;
          }
          if (command.doNotScroll) {
            doNotScroll = true;
          }
        }
        newEditorCtrl = pushState(
          newEditorCtrl,
          newEditorCtrl.value,
          inputSelection,
          getSelectionTextStyle(newEditorCtrl.value, inputSelection),
          PushStateAction.Selection,
          command.mergeLast,
        );
      } else if (command.type === CommandType.SelectAll) {
        const firstBlock = newEditorCtrl.value.blocks[0];
        const lastBlock =
          newEditorCtrl.value.blocks[newEditorCtrl.value.blocks.length - 1];
        processCommand(
          {
            type: CommandType.Selection,
            selection: {
              type: SelectionType.Block,
              editorId: newEditorCtrl.value.id,
              start:
                firstBlock.type === BlockNodeType.Paragraph
                  ? {
                      type: BlockSelectionPointType.Paragraph,
                      blockId: firstBlock.id,
                      offset: 0,
                    }
                  : {
                      type: BlockSelectionPointType.OtherBlock,
                      blockId: firstBlock.id,
                    },
              end:
                lastBlock.type === BlockNodeType.Paragraph
                  ? {
                      type: BlockSelectionPointType.Paragraph,
                      blockId: lastBlock.id,
                      offset: getParagraphLength(lastBlock),
                    }
                  : {
                      type: BlockSelectionPointType.OtherBlock,
                      blockId: lastBlock.id,
                    },
            },
            doNotScroll: true,
          },
          i,
        );
      }
    }
    for (let i = 0; i < queue.length; i++) {
      processCommand(queue[i], i);
    }
    if (setNewSelection) {
      newDomSelectionRef.current = {
        sel: newEditorCtrl.selection,
        doNotScroll,
      };
    }
    if (!newEditorCtrl.selection) {
      editorRef.current!.blur();
    }
    if (editorCtrl.current !== newEditorCtrl) {
      editorCtrl.current = newEditorCtrl;
      flushSync(() => {
        setRenderToggle((t) => !t);
      });
    }
  }, [copySelection, makeId, pushState]);

  useEffect(() => {
    if (newDomSelectionRef.current !== null) {
      const sel = newDomSelectionRef.current;
      if (!isMouseDownRef.current) {
        if (sel.sel) {
          updateSelection(sel.sel);
        } else {
          editorRef.current!.blur();
        }
      }
      newDomSelectionRef.current = null;
      const selection = window.getSelection();
      if (!selection) {
        console.error('no dom selection after set manually');
        return;
      }
      if (sel.sel && !sel.doNotScroll) {
        scrollIntoView(selection);
      }
    }
  });

  function isFocused(): boolean {
    return (
      !!document.activeElement &&
      [
        editorRef.current!,
        ...Array.from(
          editorRef.current!.querySelectorAll('[contenteditable="true"]'),
        ),
      ].some((el) => document.activeElement === el)
    );
  }

  const hasPlaceholder =
    editorCtrl.current.value.blocks.length === 1 &&
    editorCtrl.current.value.blocks[0].type === BlockNodeType.Paragraph &&
    getParagraphLength(editorCtrl.current.value.blocks[0]) === 0 &&
    Object.keys(editorCtrl.current.textStyle).every(
      (k) => editorCtrl.current.textStyle === undefined,
    ) &&
    Object.keys(editorCtrl.current.value.blocks[0].style).every(
      (k) =>
        (editorCtrl.current.value.blocks[0] as ParagraphNode).style[
          k as keyof ParagraphStyle
        ] === (k === 'type' ? ParagraphStyleType.Default : undefined),
    );

  const queueCommand = useCallback(
    (command: Command): void => {
      function shouldBatchWithNext(cmd: Command): boolean {
        return (
          cmd.type === CommandType.DeleteBackwardKey ||
          cmd.type === CommandType.DeleteForwardKey ||
          cmd.type === CommandType.SpaceKey ||
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
        if (!shouldBatchWithNext(command)) {
          inputQueueRef.current.push(command);
          flushInputQueue();
          return;
        }
        inputQueueRequestRef.current = window.setTimeout(
          flushInputQueue,
          1000 / 60,
        );
      } else {
        const lastCommand =
          inputQueueRef.current[inputQueueRef.current.length - 1];
        if (shouldBatchWithNext(lastCommand)) {
          if (inputQueueRequestRef.current !== null) {
            window.clearTimeout(inputQueueRequestRef.current!);
          }
          inputQueueRef.current.push(command);
          flushInputQueue();
          return;
        }
      }
      inputQueueRef.current.push(command);
    },
    [flushInputQueue],
  );

  const onBeforeInput = useCallback(
    (event: InputEvent): void => {
      if (!isFocused()) {
        return;
      }
      event.preventDefault();
      const curNativeSelection = window.getSelection()!;
      const encompassingRange = getEncompassingRange(curNativeSelection);
      const targetRange = event.getTargetRanges()[0] || encompassingRange;
      if (
        hasPlaceholder &&
        placeholderRef.current &&
        (targetRange.startContainer === placeholderRef.current ||
          targetRange.endContainer === placeholderRef.current ||
          placeholderRef.current.contains(targetRange.startContainer) ||
          placeholderRef.current.contains(targetRange.endContainer))
      ) {
        return;
      }
      let selection: Selection;
      try {
        selection = findSelection(editorCtrl.current.value, targetRange, false);
      } catch (error) {
        console.error('error finding selection', error);
        return;
      }
      function areSelectionsTheSameOrBackwards(
        sel1: Selection,
        sel2: Selection,
      ): boolean {
        return (
          (sel1.editorId === sel2.editorId &&
            sel1.type === SelectionType.Table &&
            sel2.type === SelectionType.Table &&
            sel1.tableId === sel2.tableId &&
            sel1.startCell.rowIndex === sel2.endCell.rowIndex &&
            sel1.startCell.columnIndex === sel2.endCell.columnIndex &&
            sel1.endCell.rowIndex === sel2.startCell.rowIndex &&
            sel1.endCell.columnIndex === sel2.startCell.columnIndex) ||
          (sel1.type === SelectionType.Block &&
            sel2.type === SelectionType.Block &&
            sel1.start.blockId === sel2.end.blockId &&
            ((sel1.start.type === BlockSelectionPointType.OtherBlock &&
              sel2.end.type === BlockSelectionPointType.OtherBlock) ||
              (sel1.start.type === BlockSelectionPointType.Paragraph &&
                sel2.end.type === BlockSelectionPointType.Paragraph &&
                sel1.start.offset === sel2.end.offset)) &&
            sel1.end.blockId === sel2.start.blockId &&
            ((sel1.end.type === BlockSelectionPointType.OtherBlock &&
              sel2.start.type === BlockSelectionPointType.OtherBlock) ||
              (sel1.end.type === BlockSelectionPointType.Paragraph &&
                sel2.start.type === BlockSelectionPointType.Paragraph &&
                sel1.end.offset === sel2.start.offset)))
        );
      }
      const nativeSelection = findSelection(
        editorCtrl.current.value,
        encompassingRange,
        isSelectionBackwards(curNativeSelection!),
      );
      if (
        editorCtrl.current.selection &&
        areSelectionsTheSameOrBackwards(selection, editorCtrl.current.selection)
      ) {
        selection = editorCtrl.current.selection;
      } else if (areSelectionsTheSameOrBackwards(selection, nativeSelection)) {
        selection = nativeSelection;
      }
      let data: EditorDataTransfer | undefined;
      function mapValue(value: EditorValue): EditorValue {
        return makeEditorValue(
          value.blocks.map((block) => {
            if (block.type !== BlockNodeType.Paragraph) {
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
    },
    [hasPlaceholder, makeId, queueCommand],
  );

  useEffect(() => {
    return () => {
      if (inputQueueRequestRef.current !== null) {
        window.clearTimeout(inputQueueRequestRef.current);
      }
    };
  }, []);

  const onHTMLSelectionChange = useCallback(
    (
      eventOrForce: Event | true,
      mouseDownFirefoxStart?: Selection | null,
    ): void => {
      if (isMouseDownRef.current === true) {
        isMouseDownRef.current = 1;
      }

      if (isUpdatingSelection.current > 0) {
        return;
      }

      const nativeSelection = window.getSelection()!;

      if (
        document.activeElement &&
        editorRef.current!.contains(document.activeElement) &&
        nativeSelection.anchorNode &&
        closest(nativeSelection.anchorNode, '.monaco-editor')
      ) {
        const blockId = closest(
          nativeSelection.anchorNode!,
          `[data-type="${BlockNodeType.Code}"]`,
        )!.getAttribute('data-id')!;
        const editorId = closest(
          nativeSelection.anchorNode!,
          `[data-family="${EditorFamilyType.Editor}"]`,
        )!.getAttribute('data-id')!;
        queueCommand({
          type: CommandType.Selection,
          selection: {
            type: SelectionType.Block,
            editorId,
            start: {
              type: BlockSelectionPointType.OtherBlock,
              blockId,
            },
            end: {
              type: BlockSelectionPointType.OtherBlock,
              blockId,
            },
          },
          doNotUpdateSelection: true,
          mergeLast: true,
        });
        return;
      }

      if (!isFocused() || nativeSelection.rangeCount === 0) {
        queueCommand({
          type: CommandType.Selection,
          selection: null,
        });
        return;
      }

      if (
        eventOrForce !== true &&
        isFirefox &&
        nativeSelection.focusNode instanceof HTMLElement &&
        nativeSelection.focusNode.matches('.block-table__tr')
      ) {
        return;
      }

      if (
        hasPlaceholder &&
        placeholderRef.current &&
        (nativeSelection.anchorNode === placeholderRef.current ||
          nativeSelection.focusNode === placeholderRef.current ||
          placeholderRef.current.contains(nativeSelection.anchorNode) ||
          placeholderRef.current.contains(nativeSelection.focusNode))
      ) {
        const curSelection: Selection = {
          type: SelectionType.Block,
          editorId: editorCtrl.current.value.id,
          start: {
            type: BlockSelectionPointType.Paragraph,
            blockId: editorCtrl.current.value.blocks[0].id,
            offset: 0,
          },
          end: {
            type: BlockSelectionPointType.Paragraph,
            blockId: editorCtrl.current.value.blocks[0].id,
            offset: 0,
          },
        };
        queueCommand({
          type: CommandType.Selection,
          selection: curSelection,
        });
        return;
      }

      let curSelection: Selection;
      try {
        curSelection = findSelection(
          editorCtrl.current.value,
          getEncompassingRange(nativeSelection),
          isSelectionBackwards(nativeSelection),
        );
      } catch (error) {
        console.error(
          'error finding selection',
          document.activeElement,
          nativeSelection.anchorNode,
          nativeSelection.focusNode,
        );
        return;
      }
      if (
        mouseDownFirefoxStart &&
        curSelection.type === SelectionType.Table &&
        mouseDownFirefoxStart.type === SelectionType.Block &&
        isCollapsed(mouseDownFirefoxStart)
      ) {
        curSelection =
          walkEditorValues<Selection | undefined>(
            editorCtrl.current.value,
            (subValue, _data, ids) => {
              if (subValue.id !== mouseDownFirefoxStart.editorId) {
                return {
                  stop: false,
                  data: undefined,
                };
              }
              if (
                subValue.blocks.some(
                  (block) => block.id === mouseDownFirefoxStart.start.blockId,
                )
              ) {
                const tableNode = ids!.parentBlock;
                if (tableNode.id !== (curSelection as TableSelection).tableId) {
                  return {
                    stop: true,
                    data: undefined,
                  };
                }
                const firstClickedCell = getTableCellPoint(
                  tableNode,
                  subValue.id,
                );
                if (firstClickedCell.rowIndex === -1) {
                  return {
                    stop: true,
                    data: undefined,
                  };
                }
                let newSelection: TableSelection;
                const curTS = curSelection as TableSelection;
                if (
                  firstClickedCell.rowIndex === curTS.endCell.rowIndex &&
                  firstClickedCell.columnIndex === curTS.endCell.columnIndex
                ) {
                  newSelection = {
                    type: SelectionType.Table,
                    editorId: curTS.editorId,
                    tableId: curTS.tableId,
                    startCell: curTS.endCell,
                    endCell: curTS.startCell,
                  };
                } else if (
                  firstClickedCell.rowIndex === curTS.startCell.rowIndex &&
                  firstClickedCell.columnIndex === curTS.endCell.columnIndex
                ) {
                  newSelection = {
                    type: SelectionType.Table,
                    editorId: curTS.editorId,
                    tableId: curTS.tableId,
                    startCell: firstClickedCell,
                    endCell: {
                      rowIndex: curTS.endCell.rowIndex,
                      columnIndex: curTS.startCell.columnIndex,
                    },
                  };
                } else if (
                  firstClickedCell.rowIndex === curTS.endCell.rowIndex &&
                  firstClickedCell.columnIndex === curTS.startCell.columnIndex
                ) {
                  newSelection = {
                    type: SelectionType.Table,
                    editorId: curTS.editorId,
                    tableId: curTS.tableId,
                    startCell: firstClickedCell,
                    endCell: {
                      rowIndex: curTS.startCell.rowIndex,
                      columnIndex: curTS.endCell.columnIndex,
                    },
                  };
                } else {
                  newSelection = curTS;
                }
                return {
                  stop: true,
                  data: newSelection,
                };
              }
              return {
                stop: false,
                data: undefined,
              };
            },
            undefined,
            false,
          ).retValue || curSelection;
      }
      queueCommand({
        type: CommandType.Selection,
        selection: curSelection,
      });
    },
    [hasPlaceholder, queueCommand],
  );

  const onCopy = useCallback(
    (event: ClipboardEvent): void => {
      const nativeSelection = window.getSelection();
      if (!nativeSelection || !isFocused()) {
        return;
      }
      const curSelection = findSelection(
        editorCtrl.current.value,
        getEncompassingRange(nativeSelection),
        isSelectionBackwards(nativeSelection),
      );
      if (!isCollapsed(curSelection)) {
        copySelection(editorCtrl.current.value, curSelection);
      }
      event.preventDefault();
    },
    [copySelection],
  );

  const onCut = useCallback(
    (event: ClipboardEvent): void => {
      const nativeSelection = window.getSelection();
      if (!nativeSelection || !isFocused()) {
        return;
      }
      const curSelection = findSelection(
        editorCtrl.current.value,
        getEncompassingRange(nativeSelection),
        isSelectionBackwards(nativeSelection),
      );
      if (!isCollapsed(curSelection)) {
        queueCommand({
          type: CommandType.Input,
          inputType: 'deleteByCut',
          selection: curSelection,
        });
      }
      event.preventDefault();
    },
    [queueCommand],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const curSelection = window.getSelection();
      const hasSel = curSelection && isFocused();
      if (
        hasSel &&
        allPass([hasControlKey, not(hasShiftKey), hasKeyCode(186)])(event)
      ) {
        console.log(editorCtrl.current);
      }
      const sel = hasSel
        ? findSelection(
            editorCtrl.current.value,
            getEncompassingRange(curSelection),
            isSelectionBackwards(curSelection),
          )
        : null;
      const cmdKV = Object.entries(cmds);
      for (let i = 0; i < cmdKV.length; i++) {
        const [_name, cmd] = cmdKV[i];
        if (cmd.isKey(event)) {
          if (
            sel &&
            (cmd === cmds['any delete backward']
              ? sel.editorId === editorCtrl.current.value.id &&
                isCollapsed(sel) &&
                (sel as BlockSelection).start.type ===
                  BlockSelectionPointType.Paragraph &&
                (sel as BlockSelection).start.blockId ===
                  editorCtrl.current.value.blocks[0].id &&
                ((sel as BlockSelection).start as ParagraphPoint).offset === 0
              : cmd !== cmds['any delete forward'] && cmd !== cmds['space'])
          ) {
            event.preventDefault();
          }
          cmd.getCmds(sel, editorCtrl.current.makeId).forEach((command) => {
            queueCommand(command);
          });
          break;
        }
      }
    },
    [queueCommand],
  );

  const isMouseDownRef = useRef<boolean | 1>(false);
  const mouseDownFirefoxStart = useRef<Selection | null>(null);

  useEffect(() => {
    const editorElement = editorRef.current!;
    window.document.addEventListener('selectionchange', onHTMLSelectionChange);
    const stfuMonacoForBlockingScroll = (event: TouchEvent): void => {
      if (!(event.target instanceof HTMLElement)) {
        return;
      }
      if (closest(event.target, '.code-block-container')) {
        event.stopImmediatePropagation();
      }
    };
    const onMouseDown = () => {
      if (isFirefox) {
        setTimeout(() => {
          if (!isMouseDownRef.current) {
            return;
          }
          const curNativeSel = window.getSelection();
          if (curNativeSel && isFocused()) {
            mouseDownFirefoxStart.current = findSelection(
              editorCtrl.current.value,
              getEncompassingRange(curNativeSel),
              isSelectionBackwards(curNativeSel),
            );
          }
        });
      }
      isMouseDownRef.current = true;
    };
    const onMouseUp = () => {
      const val = isMouseDownRef.current;
      const mdfs = mouseDownFirefoxStart.current;
      isMouseDownRef.current = false;
      mouseDownFirefoxStart.current = null;
      if (val === 1 && editorCtrl.current.selection) {
        onHTMLSelectionChange(true, mdfs);
      }
    };
    window.addEventListener('touchstart', stfuMonacoForBlockingScroll, true);
    window.addEventListener('touchmove', stfuMonacoForBlockingScroll, true);
    window.addEventListener('touchend', stfuMonacoForBlockingScroll, true);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    editorElement.addEventListener('beforeinput', onBeforeInput);
    editorElement.addEventListener('copy', onCopy);
    editorElement.addEventListener('cut', onCut);
    editorElement.addEventListener('keydown', onKeyDown);
    return () => {
      window.document.removeEventListener(
        'selectionchange',
        onHTMLSelectionChange,
      );
      window.removeEventListener(
        'touchstart',
        stfuMonacoForBlockingScroll,
        true,
      );
      window.removeEventListener(
        'touchmove',
        stfuMonacoForBlockingScroll,
        true,
      );
      window.removeEventListener('touchend', stfuMonacoForBlockingScroll, true);
      window.addEventListener('mousedown', onMouseDown);
      window.addEventListener('mouseup', onMouseUp);
      editorElement.removeEventListener('beforeinput', onBeforeInput);
      editorElement.removeEventListener('copy', onCopy);
      editorElement.removeEventListener('cut', onCut);
      editorElement.removeEventListener('keydown', onKeyDown);
    };
  }, [onHTMLSelectionChange, onBeforeInput, onCopy, onKeyDown, onCut]);

  function getListBlockIdToIdx(value: EditorValue): Record<string, number> {
    let listIdToCount: Record<string, number> = {};
    let listBlockIdToIdx: Record<string, number> = {};
    function range(start: number, endInclusive: number): number[] {
      let nums: number[] = [];
      for (let i = start; i <= endInclusive; i++) {
        nums.push(i);
      }
      return nums;
    }
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
          block.type === BlockNodeType.Paragraph &&
          block.style.type === ParagraphStyleType.NumberedList
        ) {
          const { indentLevel = 0, listId } = block.style;
          const blockId = block.id;
          const key = JSON.stringify({ indentLevel, listId });
          range(indentLevel + 1, MAX_INDENT).forEach((iL) => {
            delete listIdToCount[JSON.stringify({ indentLevel: iL, listId })];
          });
          let listIdx: number;
          if (key in listIdToCount) {
            listIdx = listIdToCount[key]++;
          } else {
            listIdx = 0;
            listIdToCount[key] = 1;
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

  const selected = useMemo(() => {
    let value = editorCtrl.current.value;
    const selection = editorCtrl.current.selection;
    if (!selection || isCollapsed(selection)) {
      return { editors: [], blocks: [] };
    }
    const selectedEditors: string[] = [];
    const selectedBlocks: string[] = [];
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
          selectedEditors.push(subValue.id);
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
            selectedEditors.push(cell.value.id);
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
            selectedEditors.push(subValue.id);
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
      (block, isSelected_, parentEditor) => {
        if (
          block.type !== BlockNodeType.Image &&
          block.type !== BlockNodeType.Code
        ) {
          return;
        }
        let isSelected = isSelected_;
        if (
          !isSelected &&
          parentEditor.id === selection.editorId &&
          selection.type === SelectionType.Block
        ) {
          const startIndex = parentEditor.blocks.findIndex(
            (otherBlock) => selection.start.blockId === otherBlock.id,
          );
          const endIndex = parentEditor.blocks.findIndex(
            (otherBlock) => selection.end.blockId === otherBlock.id,
          );
          const blockIndex = parentEditor.blocks.findIndex(
            (otherBlock) => otherBlock.id === block.id,
          );
          isSelected =
            (startIndex <= blockIndex && blockIndex <= endIndex) ||
            (endIndex <= blockIndex && blockIndex <= startIndex);
        }
        if (isSelected) {
          selectedBlocks.push(block.id);
        }
      },
    );
    return { editors: selectedEditors, blocks: selectedBlocks };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorCtrl.current.value, editorCtrl.current.selection]);
  const selectedBlocks = useCustomCompareMemo(
    () => selected.blocks,
    [selected.blocks],
    (prev, cur) =>
      prev[0].length === cur[0].length &&
      prev[0].every((v, i) => v === cur[0][i]),
  );
  const selectedEditors = useCustomCompareMemo(
    () => selected.editors,
    [selected.editors],
    (prev, cur) =>
      prev[0].length === cur[0].length &&
      prev[0].every((v, i) => v === cur[0][i]),
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
  const placeholderRef = useRef<HTMLDivElement | null>(null);
  // https://www.codemzy.com/blog/sticky-fixed-header-ios-keyboard-fix
  const [toolbarMarginTop, setToolbarMarginTop] = useState(0);
  const toolbarContainerRef = useRef<HTMLDivElement | null>(null);
  const setMargin = useCallback((): void => {
    if (!toolbarContainerRef.current) {
      return;
    }
    const newPosition = toolbarContainerRef.current.getBoundingClientRect().top;
    if (newPosition < -1) {
      let fixPosition = Math.abs(newPosition);
      if (
        window.innerHeight + window.pageYOffset >=
        document.body.offsetHeight
      ) {
        fixPosition -= 2;
      }
      setToolbarMarginTop(fixPosition);
    }
  }, []);
  function debounceLeading(
    func: () => void,
    timeout: number,
  ): { fn: () => void; cancel: () => void } {
    let timer: number | null;
    return {
      fn: (): void => {
        if (timer !== null) {
          clearTimeout(timer);
        }
        timer = window.setTimeout(() => {
          func();
        }, timeout);
      },
      cancel: (): void => {
        if (timer !== null) {
          clearTimeout(timer);
        }
      },
    };
  }
  const debouncedMargin = useMemo(
    () => debounceLeading(setMargin, 150),
    [setMargin],
  );
  const showToolbar = useCallback((): void => {
    if (!isFocused() || toolbarMarginTop > 0) {
      setToolbarMarginTop(0);
    }
    debouncedMargin.fn();
  }, [debouncedMargin, toolbarMarginTop]);
  useEffect(() => {
    window.addEventListener('scroll', showToolbar);
    return () => {
      debouncedMargin.cancel();
      window.removeEventListener('scroll', showToolbar);
    };
  }, [debouncedMargin, showToolbar]);
  return (
    <>
      <div className="toolbar-container" ref={toolbarContainerRef}>
        <div
          className={[
            'toolbar page__inner-container',
            toolbarMarginTop !== 0 && 'toolbar--down',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ marginTop: toolbarMarginTop + 'px' }}
          onMouseDown={onEditorToolbarMouseDown}
        >
          <div className="page__inner">
            {Object.entries(cmds)
              .filter(
                (
                  a,
                ): a is [
                  string,
                  Extract<(typeof cmds)[keyof typeof cmds], { icon: object }>,
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
        </div>
      </div>
      <div className="page__inner-container">
        <div className="page__inner">
          <div
            contentEditable={isClient}
            suppressContentEditableWarning
            ref={editorRef}
            className="editor"
            onBlur={() => {
              debouncedMargin.cancel();
              setToolbarMarginTop(0);
            }}
          >
            {isClient && hasPlaceholder && (
              <div className="editor__placeholder" ref={placeholderRef}>
                {placeholder}
              </div>
            )}
            <SelectedEditorsContext.Provider value={selectedEditors}>
              <SelectedBlocksContext.Provider value={selectedBlocks}>
                <NumberedListIndicesContext.Provider value={listBlockIdToIdx}>
                  <QueueCommandContext.Provider value={queueCommand}>
                    <ReactEditorValue value={editorCtrl.current.value} />
                  </QueueCommandContext.Provider>
                </NumberedListIndicesContext.Provider>
              </SelectedBlocksContext.Provider>
            </SelectedEditorsContext.Provider>
          </div>
        </div>
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
    <ToolbarIcon viewBox="0 0 12 14" {...props}>
      <path d="M0.375 1.742q-0.289-0.016-0.352-0.031l-0.023-0.688q0.102-0.008 0.312-0.008 0.469 0 0.875 0.031 1.031 0.055 1.297 0.055 0.672 0 1.313-0.023 0.906-0.031 1.141-0.039 0.438 0 0.672-0.016l-0.008 0.109 0.016 0.5v0.070q-0.469 0.070-0.969 0.070-0.469 0-0.617 0.195-0.102 0.109-0.102 1.031 0 0.102 0.004 0.254t0.004 0.199l0.008 1.789 0.109 2.188q0.047 0.969 0.398 1.578 0.273 0.461 0.75 0.719 0.688 0.367 1.383 0.367 0.813 0 1.492-0.219 0.438-0.141 0.773-0.398 0.375-0.281 0.508-0.5 0.281-0.438 0.414-0.891 0.164-0.57 0.164-1.789 0-0.617-0.027-1t-0.086-0.957-0.105-1.246l-0.031-0.461q-0.039-0.523-0.187-0.688-0.266-0.273-0.602-0.266l-0.781 0.016-0.109-0.023 0.016-0.672h0.656l1.602 0.078q0.594 0.023 1.531-0.078l0.141 0.016q0.047 0.297 0.047 0.398 0 0.055-0.031 0.242-0.352 0.094-0.656 0.102-0.57 0.086-0.617 0.133-0.117 0.117-0.117 0.32 0 0.055 0.012 0.211t0.012 0.242q0.062 0.148 0.172 3.094 0.047 1.523-0.117 2.375-0.117 0.594-0.32 0.953-0.297 0.508-0.875 0.961-0.586 0.445-1.422 0.695-0.852 0.258-1.992 0.258-1.305 0-2.219-0.359-0.93-0.367-1.398-0.953-0.477-0.594-0.648-1.523-0.125-0.625-0.125-1.852v-2.602q0-1.469-0.133-1.664-0.195-0.281-1.148-0.305zM12 12.75v-0.5q0-0.109-0.070-0.18t-0.18-0.070h-11.5q-0.109 0-0.18 0.070t-0.070 0.18v0.5q0 0.109 0.070 0.18t0.18 0.070h11.5q0.109 0 0.18-0.070t0.070-0.18z" />
    </ToolbarIcon>
  );
}

function InlineCodeIcon(props: ToolbarIconProps): JSX.Element {
  return (
    <ToolbarIcon viewBox="0 0 640 512" {...props}>
      <path d="M392.8 1.2c-17-4.9-34.7 5-39.6 22l-128 448c-4.9 17 5 34.7 22 39.6s34.7-5 39.6-22l128-448c4.9-17-5-34.7-22-39.6zm80.6 120.1c-12.5 12.5-12.5 32.8 0 45.3L562.7 256l-89.4 89.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0l112-112c12.5-12.5 12.5-32.8 0-45.3l-112-112c-12.5-12.5-32.8-12.5-45.3 0zm-306.7 0c-12.5-12.5-32.8-12.5-45.3 0l-112 112c-12.5 12.5-12.5 32.8 0 45.3l112 112c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L77.3 256l89.4-89.4c12.5-12.5 12.5-32.8 0-45.3z" />
    </ToolbarIcon>
  );
}

function StrikethroughIcon(props: ToolbarIconProps): JSX.Element {
  return (
    <ToolbarIcon viewBox="0 0 512 512" {...props}>
      <path
        xmlns="http://www.w3.org/2000/svg"
        d="M161.3 144c3.2-17.2 14-30.1 33.7-38.6c21.1-9 51.8-12.3 88.6-6.5c11.9 1.9 48.8 9.1 60.1 12c17.1 4.5 34.6-5.6 39.2-22.7s-5.6-34.6-22.7-39.2c-14.3-3.8-53.6-11.4-66.6-13.4c-44.7-7-88.3-4.2-123.7 10.9c-36.5 15.6-64.4 44.8-71.8 87.3c-.1 .6-.2 1.1-.2 1.7c-2.8 23.9 .5 45.6 10.1 64.6c4.5 9 10.2 16.9 16.7 23.9H32c-17.7 0-32 14.3-32 32s14.3 32 32 32H480c17.7 0 32-14.3 32-32s-14.3-32-32-32H270.1c-.1 0-.3-.1-.4-.1l-1.1-.3c-36-10.8-65.2-19.6-85.2-33.1c-9.3-6.3-15-12.6-18.2-19.1c-3.1-6.1-5.2-14.6-3.8-27.4zM348.9 337.2c2.7 6.5 4.4 15.8 1.9 30.1c-3 17.6-13.8 30.8-33.9 39.4c-21.1 9-51.7 12.3-88.5 6.5c-18-2.9-49.1-13.5-74.4-22.1c-5.6-1.9-11-3.7-15.9-5.4c-16.8-5.6-34.9 3.5-40.5 20.3s3.5 34.9 20.3 40.5c3.6 1.2 7.9 2.7 12.7 4.3l0 0 0 0c24.9 8.5 63.6 21.7 87.6 25.6l0 0 .2 0c44.7 7 88.3 4.2 123.7-10.9c36.5-15.6 64.4-44.8 71.8-87.3c3.6-21 2.7-40.4-3.1-58.1H335.1c7 5.6 11.4 11.2 13.9 17.2z"
      />
    </ToolbarIcon>
  );
}

function SuperscriptIcon(props: ToolbarIconProps): JSX.Element {
  return (
    <ToolbarIcon viewBox="0 0 512 512" {...props}>
      <path d="M480 32c0-11.1-5.7-21.4-15.2-27.2s-21.2-6.4-31.1-1.4l-32 16c-15.8 7.9-22.2 27.1-14.3 42.9C393 73.5 404.3 80 416 80v80c-17.7 0-32 14.3-32 32s14.3 32 32 32h32 32c17.7 0 32-14.3 32-32s-14.3-32-32-32V32zM32 64C14.3 64 0 78.3 0 96s14.3 32 32 32H47.3l89.6 128L47.3 384H32c-17.7 0-32 14.3-32 32s14.3 32 32 32H64c10.4 0 20.2-5.1 26.2-13.6L176 311.8l85.8 122.6c6 8.6 15.8 13.6 26.2 13.6h32c17.7 0 32-14.3 32-32s-14.3-32-32-32H304.7L215.1 256l89.6-128H320c17.7 0 32-14.3 32-32s-14.3-32-32-32H288c-10.4 0-20.2 5.1-26.2 13.6L176 200.2 90.2 77.6C84.2 69.1 74.4 64 64 64H32z" />
    </ToolbarIcon>
  );
}

function SubscriptIcon(props: ToolbarIconProps): JSX.Element {
  return (
    <ToolbarIcon viewBox="0 0 512 512" {...props}>
      <path d="M32 64C14.3 64 0 78.3 0 96s14.3 32 32 32H47.3l89.6 128L47.3 384H32c-17.7 0-32 14.3-32 32s14.3 32 32 32H64c10.4 0 20.2-5.1 26.2-13.6L176 311.8l85.8 122.6c6 8.6 15.8 13.6 26.2 13.6h32c17.7 0 32-14.3 32-32s-14.3-32-32-32H304.7L215.1 256l89.6-128H320c17.7 0 32-14.3 32-32s-14.3-32-32-32H288c-10.4 0-20.2 5.1-26.2 13.6L176 200.2 90.2 77.6C84.2 69.1 74.4 64 64 64H32zM480 320c0-11.1-5.7-21.4-15.2-27.2s-21.2-6.4-31.1-1.4l-32 16c-15.8 7.9-22.2 27.1-14.3 42.9C393 361.5 404.3 368 416 368v80c-17.7 0-32 14.3-32 32s14.3 32 32 32h32 32c17.7 0 32-14.3 32-32s-14.3-32-32-32V320z" />
    </ToolbarIcon>
  );
}

function Heading1Icon(props: ToolbarIconProps): JSX.Element {
  return (
    <ToolbarIcon viewBox="0 0 384 512" {...props}>
      <path d="M32 32C14.3 32 0 46.3 0 64S14.3 96 32 96H160V448c0 17.7 14.3 32 32 32s32-14.3 32-32V96H352c17.7 0 32-14.3 32-32s-14.3-32-32-32H192 32z" />
    </ToolbarIcon>
  );
}

function Heading2Icon(props: ToolbarIconProps): JSX.Element {
  return (
    <ToolbarIcon
      viewBox="0 0 16 16"
      style={{
        width: '1.35em',
        height: '1.35em',
        paddingTop: '.3em',
      }}
      {...props}
    >
      <path d="M8.637 13V3.669H7.379V7.62H2.758V3.67H1.5V13h1.258V8.728h4.62V13h1.259zm5.329 0V3.669h-1.244L10.5 5.316v1.265l2.16-1.565h.062V13h1.244z" />
      <path d="M0 64C0 46.3 14.3 32 32 32H80h48c17.7 0 32 14.3 32 32s-14.3 32-32 32H112V208H336V96H320c-17.7 0-32-14.3-32-32s14.3-32 32-32h48 48c17.7 0 32 14.3 32 32s-14.3 32-32 32H400V240 416h16c17.7 0 32 14.3 32 32s-14.3 32-32 32H368 320c-17.7 0-32-14.3-32-32s14.3-32 32-32h16V272H112V416h16c17.7 0 32 14.3 32 32s-14.3 32-32 32H80 32c-17.7 0-32-14.3-32-32s14.3-32 32-32H48V240 96H32C14.3 96 0 81.7 0 64z" />
    </ToolbarIcon>
  );
}

function Heading3Icon(props: ToolbarIconProps): JSX.Element {
  return (
    <ToolbarIcon
      viewBox="0 0 16 16"
      style={{
        width: '1.35em',
        height: '1.35em',
        paddingTop: '.3em',
      }}
      {...props}
    >
      <path d="M7.638 13V3.669H6.38V7.62H1.759V3.67H.5V13h1.258V8.728h4.62V13h1.259zm3.022-6.733v-.048c0-.889.63-1.668 1.716-1.668.957 0 1.675.608 1.675 1.572 0 .855-.554 1.504-1.067 2.085l-3.513 3.999V13H15.5v-1.094h-4.245v-.075l2.481-2.844c.875-.998 1.586-1.784 1.586-2.953 0-1.463-1.155-2.556-2.919-2.556-1.941 0-2.966 1.326-2.966 2.74v.049h1.223z" />
    </ToolbarIcon>
  );
}

function Heading4Icon(props: ToolbarIconProps): JSX.Element {
  return (
    <ToolbarIcon
      viewBox="0 0 16 16"
      style={{
        width: '1.35em',
        height: '1.35em',
        paddingTop: '.3em',
      }}
      {...props}
    >
      <path d="M7.637 13V3.669H6.379V7.62H1.758V3.67H.5V13h1.258V8.728h4.62V13h1.259zm3.625-4.272h1.018c1.142 0 1.935.67 1.949 1.674.013 1.005-.78 1.737-2.01 1.73-1.08-.007-1.853-.588-1.935-1.32H9.108c.069 1.327 1.224 2.386 3.083 2.386 1.935 0 3.343-1.155 3.309-2.789-.027-1.51-1.251-2.16-2.037-2.249v-.068c.704-.123 1.764-.91 1.723-2.229-.035-1.353-1.176-2.4-2.954-2.385-1.873.006-2.857 1.162-2.898 2.358h1.196c.062-.69.711-1.299 1.696-1.299.998 0 1.695.622 1.695 1.525.007.922-.718 1.592-1.695 1.592h-.964v1.074z" />
    </ToolbarIcon>
  );
}

function CodeBlockIcon(props: ToolbarIconProps): JSX.Element {
  return (
    <ToolbarIcon
      viewBox="0 96 960 960"
      style={{
        width: '1.25em',
        height: '1.25em',
        paddingTop: '.45em',
      }}
      {...props}
    >
      <path d="M600 896v-60h140V316H600v-60h200v640H600Zm-440 0V256h200v60H220v520h140v60H160Z" />
    </ToolbarIcon>
  );
}

function BlockQuoteIcon(props: ToolbarIconProps): JSX.Element {
  return (
    <ToolbarIcon viewBox="0 0 448 512" {...props}>
      <path d="M448 296c0 66.3-53.7 120-120 120h-8c-17.7 0-32-14.3-32-32s14.3-32 32-32h8c30.9 0 56-25.1 56-56v-8H320c-35.3 0-64-28.7-64-64V160c0-35.3 28.7-64 64-64h64c35.3 0 64 28.7 64 64v32 32 72zm-256 0c0 66.3-53.7 120-120 120H64c-17.7 0-32-14.3-32-32s14.3-32 32-32h8c30.9 0 56-25.1 56-56v-8H64c-35.3 0-64-28.7-64-64V160c0-35.3 28.7-64 64-64h64c35.3 0 64 28.7 64 64v32 32 72z" />
    </ToolbarIcon>
  );
}

function BulletListIcon(props: ToolbarIconProps): JSX.Element {
  return (
    <ToolbarIcon viewBox="0 0 512 512" {...props}>
      <path d="M40 48C26.7 48 16 58.7 16 72v48c0 13.3 10.7 24 24 24H88c13.3 0 24-10.7 24-24V72c0-13.3-10.7-24-24-24H40zM192 64c-17.7 0-32 14.3-32 32s14.3 32 32 32H480c17.7 0 32-14.3 32-32s-14.3-32-32-32H192zm0 160c-17.7 0-32 14.3-32 32s14.3 32 32 32H480c17.7 0 32-14.3 32-32s-14.3-32-32-32H192zm0 160c-17.7 0-32 14.3-32 32s14.3 32 32 32H480c17.7 0 32-14.3 32-32s-14.3-32-32-32H192zM16 232v48c0 13.3 10.7 24 24 24H88c13.3 0 24-10.7 24-24V232c0-13.3-10.7-24-24-24H40c-13.3 0-24 10.7-24 24zM40 368c-13.3 0-24 10.7-24 24v48c0 13.3 10.7 24 24 24H88c13.3 0 24-10.7 24-24V392c0-13.3-10.7-24-24-24H40z" />
    </ToolbarIcon>
  );
}

function NumberedListIcon(props: ToolbarIconProps): JSX.Element {
  return (
    <ToolbarIcon viewBox="0 0 215 197" {...props}>
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

function UndoIcon(props: ToolbarIconProps): JSX.Element {
  return (
    <ToolbarIcon viewBox="0 0 512 512" {...props}>
      <path d="M212.333 224.333H12c-6.627 0-12-5.373-12-12V12C0 5.373 5.373 0 12 0h48c6.627 0 12 5.373 12 12v78.112C117.773 39.279 184.26 7.47 258.175 8.007c136.906.994 246.448 111.623 246.157 248.532C504.041 393.258 393.12 504 256.333 504c-64.089 0-122.496-24.313-166.51-64.215-5.099-4.622-5.334-12.554-.467-17.42l33.967-33.967c4.474-4.474 11.662-4.717 16.401-.525C170.76 415.336 211.58 432 256.333 432c97.268 0 176-78.716 176-176 0-97.267-78.716-176-176-176-58.496 0-110.28 28.476-142.274 72.333h98.274c6.627 0 12 5.373 12 12v48c0 6.627-5.373 12-12 12z" />
    </ToolbarIcon>
  );
}

function RedoIcon(props: ToolbarIconProps): JSX.Element {
  return (
    <ToolbarIcon viewBox="0 0 512 512" {...props}>
      <path d="M447.5 224H456c13.3 0 24-10.7 24-24V72c0-9.7-5.8-18.5-14.8-22.2s-19.3-1.7-26.2 5.2L397.4 96.6c-87.6-86.5-228.7-86.2-315.8 1c-87.5 87.5-87.5 229.3 0 316.8s229.3 87.5 316.8 0c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0c-62.5 62.5-163.8 62.5-226.3 0s-62.5-163.8 0-226.3c62.2-62.2 162.7-62.5 225.3-1L311 183c-6.9 6.9-8.9 17.2-5.2 26.2s12.5 14.8 22.2 14.8H447.5z" />
    </ToolbarIcon>
  );
}

function IndentIcon(props: ToolbarIconProps): JSX.Element {
  return (
    <ToolbarIcon viewBox="0 0 448 512" {...props}>
      <path d="M0 64C0 46.3 14.3 32 32 32H416c17.7 0 32 14.3 32 32s-14.3 32-32 32H32C14.3 96 0 81.7 0 64zM192 192c0-17.7 14.3-32 32-32H416c17.7 0 32 14.3 32 32s-14.3 32-32 32H224c-17.7 0-32-14.3-32-32zm32 96H416c17.7 0 32 14.3 32 32s-14.3 32-32 32H224c-17.7 0-32-14.3-32-32s14.3-32 32-32zM0 448c0-17.7 14.3-32 32-32H416c17.7 0 32 14.3 32 32s-14.3 32-32 32H32c-17.7 0-32-14.3-32-32zM127.8 268.6L25.8 347.9C15.3 356.1 0 348.6 0 335.3V176.7c0-13.3 15.3-20.8 25.8-12.6l101.9 79.3c8.2 6.4 8.2 18.9 0 25.3z" />
    </ToolbarIcon>
  );
}

function DedentIcon(props: ToolbarIconProps): JSX.Element {
  return (
    <ToolbarIcon viewBox="0 0 512 512" {...props}>
      <path d="M6 64C6 46.3 20.3 32 38 32H422c17.7 0 32 14.3 32 32s-14.3 32-32 32H38C20.3 96 6 81.7 6 64zM198 192c0-17.7 14.3-32 32-32H422c17.7 0 32 14.3 32 32s-14.3 32-32 32H230c-17.7 0-32-14.3-32-32zm32 96H422c17.7 0 32 14.3 32 32s-14.3 32-32 32H230c-17.7 0-32-14.3-32-32s14.3-32 32-32zM6 448c0-17.7 14.3-32 32-32H422c17.7 0 32 14.3 32 32s-14.3 32-32 32H38c-17.7 0-32-14.3-32-32zm.2-179.4c-8.2-6.4-8.2-18.9 0-25.3l101.9-79.3c10.5-8.2 25.8-.7 25.8 12.6V335.3c0 13.3-15.3 20.8-25.8 12.6L6.2 268.6z" />
    </ToolbarIcon>
  );
}

function AlignLeftIcon(props: ToolbarIconProps): JSX.Element {
  return (
    <ToolbarIcon viewBox="0 0 448 512" {...props}>
      <path d="M288 64c0 17.7-14.3 32-32 32H32C14.3 96 0 81.7 0 64S14.3 32 32 32H256c17.7 0 32 14.3 32 32zm0 256c0 17.7-14.3 32-32 32H32c-17.7 0-32-14.3-32-32s14.3-32 32-32H256c17.7 0 32 14.3 32 32zM0 192c0-17.7 14.3-32 32-32H416c17.7 0 32 14.3 32 32s-14.3 32-32 32H32c-17.7 0-32-14.3-32-32zM448 448c0 17.7-14.3 32-32 32H32c-17.7 0-32-14.3-32-32s14.3-32 32-32H416c17.7 0 32 14.3 32 32z" />
    </ToolbarIcon>
  );
}

function AlignCenterIcon(props: ToolbarIconProps): JSX.Element {
  return (
    <ToolbarIcon viewBox="0 0 448 512" {...props}>
      <path d="M352 64c0-17.7-14.3-32-32-32H128c-17.7 0-32 14.3-32 32s14.3 32 32 32H320c17.7 0 32-14.3 32-32zm96 128c0-17.7-14.3-32-32-32H32c-17.7 0-32 14.3-32 32s14.3 32 32 32H416c17.7 0 32-14.3 32-32zM0 448c0 17.7 14.3 32 32 32H416c17.7 0 32-14.3 32-32s-14.3-32-32-32H32c-17.7 0-32 14.3-32 32zM352 320c0-17.7-14.3-32-32-32H128c-17.7 0-32 14.3-32 32s14.3 32 32 32H320c17.7 0 32-14.3 32-32z" />
    </ToolbarIcon>
  );
}

function AlignRightIcon(props: ToolbarIconProps): JSX.Element {
  return (
    <ToolbarIcon viewBox="0 0 448 512" {...props}>
      <path d="M448 64c0 17.7-14.3 32-32 32H192c-17.7 0-32-14.3-32-32s14.3-32 32-32H416c17.7 0 32 14.3 32 32zm0 256c0 17.7-14.3 32-32 32H192c-17.7 0-32-14.3-32-32s14.3-32 32-32H416c17.7 0 32 14.3 32 32zM0 192c0-17.7 14.3-32 32-32H416c17.7 0 32 14.3 32 32s-14.3 32-32 32H32c-17.7 0-32-14.3-32-32zM448 448c0 17.7-14.3 32-32 32H32c-17.7 0-32-14.3-32-32s14.3-32 32-32H416c17.7 0 32 14.3 32 32z" />
    </ToolbarIcon>
  );
}

function AlignJustifyIcon(props: ToolbarIconProps): JSX.Element {
  return (
    <ToolbarIcon viewBox="0 0 448 512" {...props}>
      <path d="M448 64c0-17.7-14.3-32-32-32H32C14.3 32 0 46.3 0 64S14.3 96 32 96H416c17.7 0 32-14.3 32-32zm0 256c0-17.7-14.3-32-32-32H32c-17.7 0-32 14.3-32 32s14.3 32 32 32H416c17.7 0 32-14.3 32-32zM0 192c0 17.7 14.3 32 32 32H416c17.7 0 32-14.3 32-32s-14.3-32-32-32H32c-17.7 0-32 14.3-32 32zM448 448c0-17.7-14.3-32-32-32H32c-17.7 0-32 14.3-32 32s14.3 32 32 32H416c17.7 0 32-14.3 32-32z" />
    </ToolbarIcon>
  );
}

export default function Home() {
  const makeId = useCallback(() => uuidv4(), []);

  return (
    <div
      className="page"
      style={
        {
          '--main-font': mainFont.style.fontFamily,
          '--code-font': codeFont.style.fontFamily,
        } as React.CSSProperties
      }
    >
      {preloadComponents.map((PC, i) => (
        <PC key={i} />
      ))}
      <main className="editor-wrapper">
        <ReactEditor
          placeholder="Type here..."
          initialValue={require('./initialState.json')}
          makeId={makeId}
        />
      </main>
    </div>
  );
}
