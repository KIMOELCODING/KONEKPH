import { useEffect, useRef } from 'react';
import Quill from 'quill';
import 'quill/dist/quill.snow.css';

// Emit text alignment as inline `style="text-align:…"` instead of Quill's default
// `class="ql-align-…"`. The broker reader page (index.html) does NOT load Quill's
// stylesheet, so inline styles are what make alignment render there. Registered
// once at module load; `true` overwrites the default class attributor.
const AlignStyle = Quill.import('attributors/style/align');
Quill.register(AlignStyle, true);

// Supported formats: headings, bold/italic/underline, links, ordered + bullet
// lists, and alignment. Quill 1.3.7 outputs semantic <ul>/<ol> (Quill 2.x emits
// <ol data-list> which needs Quill CSS to distinguish bullets from numbers), so
// the stored HTML renders correctly anywhere.
const TOOLBAR = [
  [{ header: [1, 2, 3, false] }],
  ['bold', 'italic', 'underline'],
  ['link'],
  [{ list: 'ordered' }, { list: 'bullet' }],
  [{ align: [] }],
  ['clean'],
  // TODO(phase-3): inline image insert. The `article-images` bucket + the
  // uploadImage() helper in AdminArticles already exist; the clean approach is a
  // custom Quill `image` toolbar handler that uploads the file and inserts the
  // returned public URL (instead of Quill's default base64 embed, which would
  // bloat articles.body). Left out for now — the featured-image dropzone covers
  // the primary image need.
];

interface Props {
  value: string;
  onChange: (html: string) => void;
}

const EMPTY = '<p><br></p>'; // Quill's representation of an empty document.

// Quill's clipboard.convert()/dangerouslyPasteHTML inserts an extra newline at
// block→list/heading boundaries (a paragraph before a list yields "…\n\n"), which
// renders as a stray empty line and ACCUMULATES on each edit→save→reload cycle.
// Collapse runs of newlines inside UNATTRIBUTED text inserts (plain paragraph
// breaks) to a single one. Attributed inserts (list/header/align carry real line
// separators) are left untouched, so no formatting or list items are merged.
// Idempotent — reloading already-clean HTML changes nothing.
function stripStrayBlankLines(delta: any) {
  (delta?.ops || []).forEach((op: any) => {
    if (typeof op.insert === 'string' && (!op.attributes || Object.keys(op.attributes).length === 0)) {
      op.insert = op.insert.replace(/\n{2,}/g, '\n');
    }
  });
}

function seed(q: any, value: string) {
  if (value && value.indexOf('<') >= 0) {
    // HTML body (from a prior RTE save) — convert to a Delta, drop the stray
    // boundary blank lines, then load. 'silent' so seeding doesn't echo onChange.
    const delta = q.clipboard.convert(value);
    stripStrayBlankLines(delta);
    q.setContents(delta, 'silent');
  } else if (value) {
    // Legacy plain-text body — load as text so it isn't misparsed as markup.
    q.setText(value, 'silent');
  } else {
    q.setText('', 'silent');
  }
}

export default function RichTextEditor({ value, onChange }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const quillRef = useRef<any>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Initialize Quill once on mount. The parent (ArticleForm) unmounts/remounts
  // this component whenever the form opens, so `value` here is the correct seed.
  useEffect(() => {
    if (!hostRef.current || quillRef.current) return;
    const q = new Quill(hostRef.current, {
      theme: 'snow',
      modules: { toolbar: TOOLBAR },
      placeholder: 'Write the full article body…',
    });
    quillRef.current = q;
    seed(q, value); // seed BEFORE attaching the listener so it doesn't fire here
    q.on('text-change', () => {
      const html = q.root.innerHTML;
      onChangeRef.current(html === EMPTY ? '' : html);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Safety net: if `value` is replaced externally while mounted, resync — but
  // never while the user is typing (would fight the caret).
  useEffect(() => {
    const q = quillRef.current;
    if (!q) return;
    const current = q.root.innerHTML === EMPTY ? '' : q.root.innerHTML;
    if (value !== current && !q.hasFocus()) seed(q, value);
  }, [value]);

  return (
    <div className="rte">
      <div ref={hostRef} />
    </div>
  );
}
