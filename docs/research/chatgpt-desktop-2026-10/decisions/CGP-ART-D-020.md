## CGP-ART-D-020: collapsible row and one-line names (2026-10-27, agent choice)

- Collapsible: the row rests collapsed to its "AI가 한 일" title and the verb chips. A chip opens its own list; pressing it again, or another chip, folds that list back, so at most one list is open. The chips themselves never fold away: they are the summary the learner judges the AI's work by (Product Intent 2), and a collapsed row with no counts would hide it.
- Chips read "읽음 3", "만듦 1" and so on, one chip per verb with at least one entry; the register's "·" separators are the chip gaps, not characters.
- Middle ellipsis: the shown name is the longest middle-ellipsized form, at most 48 characters, that fits one line at the width the list has, measured with the element's own font and refitted on resize. Below 12 characters the name stops shrinking and wraps, because a shorter cut no longer names the file. The full name stays in the tooltip and is what assistive technology reads.
- Targets 44px and text 14px (owner rule) win over the register's chip size. Default state: on (local display only; no data flow change).

