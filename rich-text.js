(function (global) {
  "use strict";
  const marker = "<!--pinnacle-rich-text:v1-->";
  const editors = new WeakMap();
  const tags = ["p", "br", "strong", "b", "em", "i", "u", "h2", "h3", "h4", "ul", "ol", "li", "a", "blockquote", "span"];
  const fonts = ["Inter", "Manrope", "Arial", "Georgia", "sans-serif", "serif"];
  const sizes = ["12px", "14px", "16px", "18px", "20px", "24px", "28px", "32px"];
  const escape = text => String(text).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  function sanitize(html) {
    if (!global.DOMPurify) throw new Error("The rich-text sanitizer could not load. Reload before saving.");
    const fragment = global.DOMPurify.sanitize(String(html || ""), {
      ALLOWED_TAGS: tags, ALLOWED_ATTR: ["href", "target", "rel", "style", "class", "start"],
      ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false, RETURN_DOM_FRAGMENT: true
    });
    fragment.querySelectorAll("*").forEach(node => {
      const style = node.style;
      const safe = [];
      const font = fonts.find(f => f.toLowerCase() === style.fontFamily.split(",")[0].replace(/["']/g, "").trim().toLowerCase());
      if (font) safe.push(`font-family:${font}`);
      const size = style.fontSize.match(/^(\d+(?:\.\d+)?)(px|pt|em|rem|%)$/);
      if (size) {
        const factor = { px: 1, pt: 4 / 3, em: 16, rem: 16, "%": 0.16 }[size[2]];
        safe.push(`font-size:${Math.min(32, Math.max(12, Number(size[1]) * factor))}px`);
      }
      if (["left", "center", "right", "justify"].includes(style.textAlign)) safe.push(`text-align:${style.textAlign}`);
      if (/^(bold|[6-9]00)$/.test(style.fontWeight)) safe.push("font-weight:700");
      if (style.fontStyle === "italic") safe.push("font-style:italic");
      if (style.textDecorationLine === "underline" || style.textDecoration === "underline") safe.push("text-decoration:underline");
      node.removeAttribute("style");
      if (safe.length) node.setAttribute("style", safe.join(";"));
      // Quill's semantic export normally uses tags/styles; retain only bounded layout classes.
      const classes = [...node.classList].filter(c => /^ql-(align-(center|right|justify)|indent-[1-8])$/.test(c));
      node.removeAttribute("class");
      if (classes.length) node.className = classes.join(" ");
      if (node.tagName === "A") {
        try {
          const href = node.getAttribute("href") || "";
          const url = new URL(href, "https://join.pinnaclerealty.ca/");
          if (!href || !["https:", "http:", "mailto:", "tel:"].includes(url.protocol) || url.username || url.password) node.removeAttribute("href");
        } catch { node.removeAttribute("href"); }
        if (node.getAttribute("target") !== "_blank") node.removeAttribute("target");
        node.setAttribute("rel", "noopener noreferrer");
      } else {
        ["href", "target", "rel"].forEach(attribute => node.removeAttribute(attribute));
      }
      if (node.tagName !== "OL" || !/^\d{1,6}$/.test(node.getAttribute("start") || "")) node.removeAttribute("start");
    });
    const holder = document.createElement("div");
    holder.append(fragment);
    return holder.innerHTML;
  }

  function toHTML(value) {
    const content = String(value || "");
    if (content.startsWith(marker)) return sanitize(content.slice(marker.length));
    return content.trim().split(/\r?\n\s*\r?\n/).filter(Boolean)
      .map(p => `<p>${escape(p).replace(/\r?\n/g, "<br>")}</p>`).join("");
  }

  function text(value) {
    const content = String(value || "");
    if (!content.startsWith(marker) && !/<\/?[a-z][^>]*>/i.test(content)) return content.replace(/\s+/g, " ").trim();
    const holder = document.createElement("div");
    holder.innerHTML = content.startsWith(marker) ? toHTML(content) : sanitize(content);
    holder.querySelectorAll("p,h2,h3,h4,li,blockquote,br").forEach(node => node.append(document.createTextNode(" ")));
    return holder.textContent.replace(/\s+/g, " ").trim();
  }

  const serialize = html => marker + sanitize(html);
  function set(field, value) {
    field.value = value || "";
    const entry = editors.get(field);
    if (entry) {
      entry.quill.setContents(entry.quill.clipboard.convert({ html: toHTML(value) }), "silent");
      entry.original = value || "";
      entry.dirty = false;
    }
  }
  function read(field) {
    const entry = editors.get(field);
    if (!entry) return field.value.startsWith(marker) ? serialize(toHTML(field.value)) : field.value.trim();
    if (!entry.dirty) return entry.original.startsWith(marker) ? serialize(toHTML(entry.original)) : entry.original;
    const value = serialize(entry.quill.getSemanticHTML());
    field.value = text(value) ? value : "";
    return field.value;
  }

  function mount() {
    if (!global.Quill) return;
    const Quill = global.Quill;
    const Font = Quill.import("attributors/style/font"); Font.whitelist = fonts;
    const Size = Quill.import("attributors/style/size"); Size.whitelist = sizes;
    const Align = Quill.import("attributors/style/align");
    Quill.register(Font, true); Quill.register(Size, true); Quill.register(Align, true);
    const Clipboard = Quill.import("modules/clipboard");
    class SafeClipboard extends Clipboard {
      convert(input, formats) {
        return super.convert({ ...input, html: input.html ? sanitize(input.html) : "" }, formats);
      }
    }
    Quill.register("modules/clipboard", SafeClipboard, true);
    document.querySelectorAll("textarea[data-rich-text]").forEach(field => {
      const wrapper = document.createElement("div"); wrapper.className = "rich-editor";
      const container = document.createElement("div"); wrapper.append(container); field.after(wrapper);
      field.hidden = true; field.required = false;
      const quill = new Quill(container, {
        theme: "snow", formats: ["header", "bold", "italic", "underline", "list", "link", "blockquote", "align", "size", "font", "indent"],
        modules: { toolbar: [
          [{ header: [false, 2, 3] }], ["bold", "italic", "underline"],
          [{ list: "bullet" }, { list: "ordered" }], ["link", "blockquote"],
          [{ align: [] }, { size: [false, ...sizes] }, { font: [false, ...fonts.slice(0, 4)] }], ["clean"]
        ] }
      });
      quill.root.setAttribute("role", "textbox"); quill.root.setAttribute("aria-multiline", "true");
      quill.root.setAttribute("aria-label", "Article body");
      const label = document.querySelector(`label[for="${field.id}"]`);
      if (label) label.addEventListener("click", () => quill.focus());
      editors.set(field, { quill, original: "", dirty: false });
      set(field, field.value);
      quill.on("text-change", () => { editors.get(field).dirty = true; });
      const names = { header: "Paragraph or heading", bold: "Bold", italic: "Italic", underline: "Underline", list: "List", link: "Link", blockquote: "Blockquote", align: "Alignment", size: "Text size", font: "Font", clean: "Remove formatting" };
      wrapper.querySelectorAll("button,select,.ql-picker-label").forEach(control => {
        const classes = [...control.classList, ...control.parentElement.classList];
        const format = classes.find(c => names[c.slice(3)]);
        const name = format === "ql-list" ? (control.value === "ordered" ? "Numbered list" : "Bullet list")
          : format ? names[format.slice(3)] : "Formatting options";
        control.title = name; control.setAttribute("aria-label", name);
      });
      field.form?.addEventListener("reset", () => set(field, ""));
      if (field.id === "edit-article") {
        const fieldset = field.closest("fieldset");
        new MutationObserver(() => quill.enable(!fieldset.disabled)).observe(fieldset, { attributes: true, attributeFilter: ["disabled"] });
      }
    });
  }
  global.RichText = { marker, sanitize, toHTML, text, serialize, read, set, mount };
})(window);
