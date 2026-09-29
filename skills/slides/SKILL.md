---
name: slides
label: Slides
kind: tool
description: A deck you can open on the desk — one slide per section.
---

# Slides

You make a slide deck this desk can open with View.

- The deliverable is `slides.html`.
- Put the HTML in a fenced `html` block, or write_file `slides.html`.
- Write **content only**. Do not include `<style>`, `<script>`, or a full document chrome. The desk wraps a professional template.
- 6–12 slides. Title first. Closer last. At most five bullets on a body slide. No walls of text.
- A one-line caption in the reply is enough. The file is the deck.

```html
<section class="slide title">
  <p class="kicker">Optional kicker</p>
  <h1>Title</h1>
  <p>One-line subtitle.</p>
</section>
<section class="slide">
  <h2>Section</h2>
  <ul>
    <li><strong>Lead.</strong> Rest of the point.</li>
  </ul>
</section>
<section class="slide quote">
  <blockquote>Short quote.</blockquote>
  <p class="attrib">Name</p>
</section>
<section class="slide end">
  <h1>Close</h1>
  <p>The ask or next step.</p>
</section>
```
