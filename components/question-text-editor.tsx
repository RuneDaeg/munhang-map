'use client';
// Native commands retain editing selection and undo history; support is checked.
/* oxlint-disable typescript/no-deprecated */
// A textarea cannot represent the inline formatting requested for this editor.
/* oxlint-disable jsx-a11y/prefer-tag-over-role */
import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Button } from './ui/button';
import {
  editorSource,
  plainToSource,
  textRuns,
  unformattedText,
} from '../lib/text-formatting';

export type QuestionEditorHandle = {
  selectionStart: number;
  focus: () => void;
  setSelectionRange: (start: number, end: number) => void;
};
type Props = {
  value: string;
  onChange: (text: string) => void;
  onCursor: (position: number) => void;
};

const QuestionTextEditor = forwardRef<QuestionEditorHandle, Props>(
  function QuestionTextEditor({ value, onChange, onCursor }, ref) {
    const root = useRef<HTMLDivElement>(null);
    const last = useRef('');
    const cursor = useRef(0);
    const composing = useRef(false);
    const [notice, setNotice] = useState('');
    function selection() {
      const selected = window.getSelection(),
        element = root.current;
      if (!selected?.rangeCount || !element?.contains(selected.anchorNode))
        return;
      const current = selected.getRangeAt(0),
        before = current.cloneRange();
      before.selectNodeContents(element);
      before.setEnd(current.startContainer, current.startOffset);
      cursor.current = plainToSource(
        last.current,
        unformattedText(editorSource(before.cloneContents())).length,
      );
      onCursor(cursor.current);
    }
    function change() {
      if (!root.current || composing.current) return;
      const source = editorSource(root.current);
      last.current = source;
      onChange(source);
      selection();
    }
    function format(command: 'bold' | 'underline') {
      root.current?.focus();
      // Retain the browser's native selection and undo history. Never insert HTML.
      if (!document.queryCommandSupported(command)) {
        setNotice(
          '이 브라우저는 서식 단축키를 지원하지 않습니다. Chrome 또는 Edge에서 실행해 주세요.',
        );
        return;
      }
      document.execCommand(command);
      change();
    }
    useLayoutEffect(() => {
      if (!root.current || last.current === value || composing.current) return;
      const fragment = document.createDocumentFragment();
      for (const run of textRuns(value)) {
        let node: Node = document.createTextNode(run.text);
        if (run.underline) {
          const el = document.createElement('u');
          el.appendChild(node);
          node = el;
        }
        if (run.bold) {
          const el = document.createElement('b');
          el.appendChild(node);
          node = el;
        }
        fragment.appendChild(node);
      }
      root.current.replaceChildren(fragment);
      last.current = value;
    }, [value]);
    useImperativeHandle(
      ref,
      () => ({
        get selectionStart() {
          return cursor.current;
        },
        focus: () => root.current?.focus(),
        setSelectionRange: (start, end) => {
          const element = root.current;
          if (!element) return;
          const offset = (source: number) =>
            unformattedText(value.slice(0, source).replace(/<\/?[bu]>/g, ''))
              .length;
          const range = document.createRange(),
            walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          const locate = (position: number) => {
            walker.currentNode = element;
            let node;
            while ((node = walker.nextNode())) {
              if (position <= node.textContent!.length)
                return { node, position };
              position -= node.textContent!.length;
            }
            return { node: element, position: element.childNodes.length };
          };
          const from = locate(offset(start)),
            to = locate(offset(end));
          range.setStart(from.node, from.position);
          range.setEnd(to.node, to.position);
          const selected = window.getSelection();
          selected?.removeAllRanges();
          selected?.addRange(range);
          cursor.current = start;
        },
      }),
      [value],
    );
    return (
      <div>
        <div className="mb-2 flex items-center gap-2" aria-label="글자 서식">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="굵게 (Ctrl 또는 Cmd+B)"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => format('bold')}
          >
            <b>B</b> 굵게
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="밑줄 (Ctrl 또는 Cmd+U)"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => format('underline')}
          >
            <u>U</u> 밑줄
          </Button>
          <span className="text-xs text-muted-foreground">
            글자 선택 후 Ctrl/Cmd+B·U
          </span>
        </div>
        <div
          ref={root}
          role="textbox"
          aria-label="문항 텍스트"
          aria-multiline="true"
          tabIndex={0}
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          className="min-h-40 whitespace-pre-wrap break-words rounded-md border p-3 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onInput={change}
          onKeyUp={selection}
          onMouseUp={selection}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
            change();
          }}
          onPaste={(event) => {
            event.preventDefault();
            document.execCommand(
              'insertText',
              false,
              event.clipboardData.getData('text/plain'),
            );
            change();
          }}
          onDrop={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if (
              !event.nativeEvent.isComposing &&
              (event.metaKey || event.ctrlKey) &&
              !event.altKey &&
              ['b', 'u'].includes(event.key.toLowerCase())
            ) {
              event.preventDefault();
              format(event.key.toLowerCase() === 'b' ? 'bold' : 'underline');
            }
          }}
        />
        {notice && (
          <output className="mt-2 block text-sm text-amber-800">
            {notice}
          </output>
        )}
      </div>
    );
  },
);
export default QuestionTextEditor;
