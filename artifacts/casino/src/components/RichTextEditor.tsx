import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect } from "react";
import {
  Bold, Italic, List, ListOrdered, Minus, Undo, Redo,
  Heading2, Heading3, Quote
} from "lucide-react";

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}

export default function RichTextEditor({ value, onChange, placeholder = "Write a description…", minHeight = 160 }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder }),
    ],
    content: value || "",
    onUpdate({ editor }) {
      const html = editor.getHTML();
      onChange(html === "<p></p>" ? "" : html);
    },
    editorProps: {
      attributes: {
        class: "focus:outline-none text-sm text-foreground leading-relaxed",
        style: `min-height:${minHeight}px`,
      },
    },
  });

  // Sync external value changes (e.g. when switching between tournaments)
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    const incoming = value || "";
    if (current !== incoming && incoming !== (current === "<p></p>" ? "" : current)) {
      editor.commands.setContent(incoming || "");
    }
  }, [value, editor]);

  if (!editor) return null;

  const btn = (active: boolean, onClick: () => void, title: string, icon: React.ReactNode) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className={`p-1.5 rounded transition-colors ${active ? "bg-amber-900 text-amber-400" : "text-muted-foreground hover:text-foreground hover:bg-white/5"}`}
    >
      {icon}
    </button>
  );

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-white/10 bg-white/[0.03]">
        {btn(editor.isActive("bold"),       () => editor.chain().focus().toggleBold().run(),       "Bold",             <Bold className="w-3.5 h-3.5" />)}
        {btn(editor.isActive("italic"),     () => editor.chain().focus().toggleItalic().run(),     "Italic",           <Italic className="w-3.5 h-3.5" />)}
        <div className="w-px h-4 bg-white/10 mx-1" />
        {btn(editor.isActive("heading", { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), "Heading 2", <Heading2 className="w-3.5 h-3.5" />)}
        {btn(editor.isActive("heading", { level: 3 }), () => editor.chain().focus().toggleHeading({ level: 3 }).run(), "Heading 3", <Heading3 className="w-3.5 h-3.5" />)}
        <div className="w-px h-4 bg-white/10 mx-1" />
        {btn(editor.isActive("bulletList"),  () => editor.chain().focus().toggleBulletList().run(),  "Bullet List",   <List className="w-3.5 h-3.5" />)}
        {btn(editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(), "Numbered List", <ListOrdered className="w-3.5 h-3.5" />)}
        {btn(editor.isActive("blockquote"),  () => editor.chain().focus().toggleBlockquote().run(),  "Quote",         <Quote className="w-3.5 h-3.5" />)}
        <div className="w-px h-4 bg-white/10 mx-1" />
        <button
          type="button"
          title="Horizontal Rule"
          onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().setHorizontalRule().run(); }}
          className="p-1.5 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-white/5"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <div className="w-px h-4 bg-white/10 mx-1" />
        {btn(!editor.can().undo(), () => editor.chain().focus().undo().run(), "Undo", <Undo className="w-3.5 h-3.5" />)}
        {btn(!editor.can().redo(), () => editor.chain().focus().redo().run(), "Redo", <Redo className="w-3.5 h-3.5" />)}
      </div>

      {/* Editor body */}
      <div className="px-3 py-2">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
