import { createContext } from 'react';

/**
 * The task workspace's heading row, where the personal chat draws its own header controls so the
 * screen has one calm header row instead of two (Jay 2026-10-19). Null outside the task workspace,
 * and the chat then keeps its header in place.
 */
export const HeadingSlotContext = createContext<HTMLElement | null>(null);
