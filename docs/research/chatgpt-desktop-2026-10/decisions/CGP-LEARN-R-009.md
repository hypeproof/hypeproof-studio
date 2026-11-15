## CGP-LEARN-R-009 / D-009: narrated diagrams, Service catalog part (2026-11-15)

- **`text_list` reuse.**
  - `narrated_diagram` v1 reuses the `text_list` param kind for three instructor-written beats (start, change, result): exactly 3 items of {title, sentence}, under the same safe-text and link rules as `stage_stepper`.
  - This extends the 2026-11-14 approval, which was for `stage_stepper` v1 only (hypeproof-service#510).
  - The reuse only: Confirmed by Jay: yes (2026-11-15), chosen option "허용". hypeproof-service#541.
- **Agent choices** (Confirmed by Jay: no):
  - The v1 diagrams are `page_request` (웹 페이지가 열리는 과정) and `html_to_page` (HTML이 화면이 되기까지), for the web-making lessons.
  - Drawings are built in only: Studio code holds the geometry, colour roles and anchor labels. Lesson data never carries SVG, HTML, paths or colours, and there is no instructor upload.
  - The width rule. `textLayerWidthPx` in service-contracts is new, not an existing bound.
    - It counts Hangul, CJK, kana, full-width, non-BMP and Extended_Pictographic characters at 1 em, which is an upper bound for Korean.
    - Everything else counts at 0.6 em, which is an average for Latin and not a bound.
    - A beat title is one line of 168 px at 14 px (12 Hangul syllables); a sentence is two lines of 488 px at 14 px.
  - The beat title maxLength is 20, where stage_stepper allows 40. Three marker labels share the 640 px artboard beside the 120 px control area, so a label is a short name, and 168 px holds 20 Latin characters.
